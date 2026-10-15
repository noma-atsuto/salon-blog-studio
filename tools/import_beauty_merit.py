"""ビューティーメリットの取得データ（beauty_merit_report の cache）から、スタッフ名だけを取り出す。

使い方:
    python3 tools/import_beauty_merit.py "/path/to/beauty_merit_report 3/cache"

出力: private/staff.json（GitHub には上げない。管理画面の「スタッフを取り込む」で読み込む）
除外: private/exclude.txt に1行1名で書いた名前は取り込まない
売上などの数字は読み込まず、名前だけを書き出します。
"""
import glob
import json
import os
import re
import sys

# 人ではないもの（合計行・お店の共通アカウントなど）は取り込まない
EXCLUDE = {"合計", "", "nan", "None", "指名なし", "フリー", "AI TOKYO STYLE"}
# 名前の後ろの店舗名（例：「山田 太郎【池袋】」「山田 [池袋]」）を外して所属店舗にする
STORE_TAG = re.compile(r"\s*[【\[［](.+?)[】\]］]\s*$")


def split_store(raw):
    m = STORE_TAG.search(raw)
    if not m:
        return raw.strip(), "池袋店"
    store = m.group(1).strip()
    return raw[: m.start()].strip(), store if store.endswith("店") else store + "店"


def private_excludes():
    """private/exclude.txt に書いた名前も外す（実名を公開のコードに書かないため）"""
    path = os.path.join(os.path.dirname(__file__), "..", "private", "exclude.txt")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {l.strip() for l in f if l.strip() and not l.startswith("#")}


def staff_names(cache_dir):
    names = []
    # 新しい月のファイルから順に見る（今いるスタッフを先頭にするため）
    for path in sorted(glob.glob(os.path.join(cache_dir, "bm_*_type1.json")), reverse=True):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for row in data.get("sales", []):
            name = str(row.get("スタッフ", "")).strip()
            if name not in EXCLUDE and name not in names:
                names.append(name)
    return names


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    names = staff_names(sys.argv[1])
    if not names:
        print("スタッフ名が見つかりませんでした。フォルダを確認してください。")
        sys.exit(1)
    out_dir = os.path.join(os.path.dirname(__file__), "..", "private")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "staff.json")
    staff = []
    excludes = private_excludes()
    for raw in names:
        name, store = split_store(raw)
        if name in excludes or raw in excludes:
            continue
        if name and all(x["name"] != name for x in staff):
            staff.append({"id": f"bm{len(staff) + 1}", "name": name, "store": store, "genres": []})
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "beauty_merit", "staff": staff}, f, ensure_ascii=False, indent=2)
    print(f"{len(staff)}名を書き出しました: {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
