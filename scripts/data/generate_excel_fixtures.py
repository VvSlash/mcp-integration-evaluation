

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook

SEED = 20260708
ROWS = 220

REGIONS = ["north", "south", "east", "west"]
PRODUCTS = [
    ("Laptop Pro 14", "electronics", 4499.00),
    ("Mysz optyczna", "electronics", 79.90),
    ("Monitor 27", "electronics", 1299.00),
    ("Biurko Standard", "furniture", 649.00),
    ("Fotel Ergo", "furniture", 899.00),
    ("Notes A5", "office", 12.50),
    ("Papier A4 (ryza)", "office", 24.90),
    ("Toner CZ-101", "office", 219.00),
]

def main() -> None:
    rng = random.Random(SEED)
    out_dir = Path("datasets") / "excel"
    out_dir.mkdir(parents=True, exist_ok=True)

    workbook = Workbook()

    sales = workbook.active
    sales.title = "Sales2025"
    sales.append(["date", "region", "product", "quantity", "unit_price", "total"])

    start = date(2025, 1, 1)
    total_sum = 0.0
    north_qty_gt_50 = 0
    for _ in range(ROWS):
        day = start + timedelta(days=rng.randrange(0, 365))
        region = rng.choice(REGIONS)
        product, _category, unit_price = rng.choice(PRODUCTS)
        quantity = rng.randint(1, 80)
        total = round(quantity * unit_price, 2)
        total_sum = round(total_sum + total, 2)
        if region == "north" and quantity > 50:
            north_qty_gt_50 += 1
        sales.append([day.isoformat(), region, product, quantity, unit_price, total])

    products_sheet = workbook.create_sheet("Products")
    products_sheet.append(["product", "category", "unit_price"])
    for product, category, unit_price in PRODUCTS:
        products_sheet.append([product, category, unit_price])

    xlsx_path = out_dir / "sales.xlsx"
    workbook.save(xlsx_path)

    expected = {
        "sheetNames": ["Sales2025", "Products"],
        "salesRowCount": ROWS,
        "totalSum": total_sum,
        "northQuantityOver50Count": north_qty_gt_50,
        "productsCount": len(PRODUCTS),
        "seed": SEED,
        "tolerance": 0.01,
    }
    expected_path = out_dir / "sales.expected.json"
    expected_path.write_text(json.dumps(expected, indent=2), encoding="utf-8")

    print(json.dumps({"written": [str(xlsx_path), str(expected_path)], "expected": expected}, indent=2))

if __name__ == "__main__":
    main()
