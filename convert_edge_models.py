import joblib
import emlearn
from pathlib import Path

MODEL_DIR = Path(r"D:\Prithvi-AI\SIH_2026\model")

model_file = "flood_edge_random_forest.pkl"
header_file = "flood_model.h"
model_name = "flood_model"

model_path = MODEL_DIR / model_file
output_path = MODEL_DIR / header_file

print(f"Converting {model_file}...")

bundle = joblib.load(model_path)
model = bundle["model"]

cmodel = emlearn.convert(
    model,
    method="inline"
)

cmodel.save(
    file=str(output_path),
    name=model_name
)

print(f"Saved: {output_path}")
print("Conversion complete.")