#!/usr/bin/env python3
"""线上 KV 迁移（与 apps/api/src/migrations/kv-v1-to-v2.js 同逻辑）
- users: 补 orgId / tokenVersion
- students: 去 published、补 orgId、重算 type、data URL 照片搬到 R2 后写 photoKeys
- idx:*: 删除（公开查询已下线）
非破坏：照片先确认 R2 写入成功，才从记录里摘掉 data URL。
用法: python3 migrate.py [--apply]   （不带 --apply = dry-run，只统计）
"""
import base64, json, re, sys, urllib.parse, subprocess, hashlib

AID = "df9099b08aefcec67ce14c18f00c7b52"
NS = "3916197cddd64ffd8dd2522e57c732c6"
BUCKET = "chsi-photos"
APPLY = "--apply" in sys.argv
TOK = subprocess.run(
    "grep -oP 'CLOUDFLARE_API_TOKEN=\\K.*' /home/ubuntu/cloudflare-token.txt | tr -d '\\r\\n \"'",
    shell=True, capture_output=True, text=True).stdout.strip()
KV = f"https://api.cloudflare.com/client/v4/accounts/{AID}/storage/kv/namespaces/{NS}"
R2 = f"https://api.cloudflare.com/client/v4/accounts/{AID}/r2/buckets/{BUCKET}/objects"
AUTH = ["-H", f"Authorization: Bearer {TOK}"]


def curl(args):
    r = subprocess.run(["curl", "-s"] + args, capture_output=True, text=True)
    return r.stdout


def list_keys(prefix=""):
    out, cur = [], None
    while True:
        u = f"{KV}/keys?limit=1000" + (f"&prefix={urllib.parse.quote(prefix)}" if prefix else "")
        if cur:
            u += f"&cursor={urllib.parse.quote(cur)}"
        d = json.loads(curl([u] + AUTH))
        out += d.get("result", [])
        cur = (d.get("result_info") or {}).get("cursor")
        if not cur or not d.get("result"):
            break
    return out


def kv_get(name):
    return curl([f"{KV}/values/{urllib.parse.quote(name, safe='')}"] + AUTH)


def kv_put(name, value):
    import tempfile, os
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write(value)
        p = f.name
    try:
        r = curl(["-X", "PUT", f"{KV}/values/{urllib.parse.quote(name, safe='')}",
                  f"--data-binary", f"@{p}", "-H", "Content-Type: application/json"] + AUTH)
        return json.loads(r or "{}").get("success", False)
    finally:
        os.unlink(p)


def kv_delete(name):
    r = curl(["-X", "DELETE", f"{KV}/values/{urllib.parse.quote(name, safe='')}"] + AUTH)
    return json.loads(r or "{}").get("success", False)


def r2_put(key, data: bytes, mime):
    import tempfile, os
    with tempfile.NamedTemporaryFile("wb", delete=False) as f:
        f.write(data)
        p = f.name
    try:
        r = curl(["-X", "PUT", f"{R2}/{urllib.parse.quote(key, safe='')}",
                  "--data-binary", f"@{p}", "-H", f"Content-Type: {mime}"] + AUTH)
        return json.loads(r or "{}").get("success", False)
    finally:
        os.unlink(p)


def r2_head(key):
    """用 GET 确认对象存在（curl -I 对 R2 objects 端点返回码不可靠）"""
    r = curl(["-o", "/dev/null", "-w", "%{http_code}", f"{R2}/{urllib.parse.quote(key, safe='')}"] + AUTH)
    return r.strip() == "200"


stats = {"users": 0, "students": 0, "photos": 0, "idx": 0, "skipped": 0, "errors": 0}
print(f"=== {'APPLY' if APPLY else 'DRY-RUN'} ===")

# ---- users ----
for k in list_keys("user:"):
    name = k["name"]
    try:
        u = json.loads(kv_get(name))
    except Exception:
        stats["skipped"] += 1
        continue
    if not u.get("salt"):
        print(f"  !! {name} 无 salt，跳过")
        stats["errors"] += 1
        continue
    changed = False
    if u.get("orgId") != "demo":
        u["orgId"] = "demo"; changed = True
    if u.get("tokenVersion") is None:
        u["tokenVersion"] = 0; changed = True
    if changed:
        print(f"  user 补字段: {name}")
        if APPLY and not kv_put(name, json.dumps(u, ensure_ascii=False)):
            print(f"     !! 写入失败 {name}"); stats["errors"] += 1; continue
        stats["users"] += 1
    else:
        stats["skipped"] += 1

# ---- students ----
for k in list_keys("student:"):
    name = k["name"]
    try:
        rec = json.loads(kv_get(name))
    except Exception:
        stats["skipped"] += 1
        continue
    changed = False
    for f in ("published",):
        if f in rec:
            del rec[f]; changed = True
    if rec.get("orgId") != "demo":
        rec["orgId"] = "demo"; changed = True
    want = "degree" if rec.get("degreeName") else ("xueli" if rec.get("status") == "已结业" else "xueji")
    if rec.get("type") != want:
        rec["type"] = want; changed = True

    if not rec.get("photoKeys"):
        pk = {}
        for n in ("photo", "photo2"):
            v = rec.get(n)
            if not isinstance(v, str) or not v:
                continue
            if re.match(r"^https?://", v, re.I):
                pk[n] = {"kind": "url", "url": v[:2000]}
            else:
                m = re.match(r"^data:(image/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$", v, re.I)
                if not m:
                    continue
                mime, b64 = m.group(1).lower(), m.group(2)
                raw = base64.b64decode(b64)
                key = f"photos/{rec['sid']}/{n}.bin"
                print(f"  照片 → R2: {key} ({len(raw)}B, {mime})")
                if APPLY:
                    if not r2_put(key, raw, mime) or not r2_head(key):
                        print(f"     !! R2 写入未确认，保留 KV 原值 {name}")
                        stats["errors"] += 1
                        continue
                pk[n] = {"kind": "stored", "key": key}
                stats["photos"] += 1
            del rec[n]
            changed = True
        rec["photoKeys"] = pk
        changed = True

    if changed:
        print(f"  student 迁移: {name} (type={rec.get('type')}, photoKeys={list((rec.get('photoKeys') or {}).keys())})")
        if APPLY and not kv_put(name, json.dumps(rec, ensure_ascii=False)):
            print(f"     !! 写入失败 {name}"); stats["errors"] += 1; continue
        stats["students"] += 1
    else:
        stats["skipped"] += 1

# ---- idx:* ----
for k in list_keys("idx:"):
    print(f"  删除索引: {k['name']}")
    if APPLY and not kv_delete(k["name"]):
        stats["errors"] += 1; continue
    stats["idx"] += 1

print(json.dumps(stats, ensure_ascii=False))
