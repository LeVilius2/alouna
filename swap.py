import json
import os

# Input and output file names
INPUT_FILE = "input.geojson"
OUTPUT_FILE = "output_swapped.geojson"

def swap_coordinates(geometry):
    if geometry["type"] == "Point":
        geometry["coordinates"] = geometry["coordinates"][::-1]
    elif geometry["type"] in ["LineString", "MultiPoint"]:
        geometry["coordinates"] = [coord[::-1] for coord in geometry["coordinates"]]
    elif geometry["type"] in ["Polygon", "MultiLineString"]:
        geometry["coordinates"] = [
            [coord[::-1] for coord in part] for part in geometry["coordinates"]
        ]
    elif geometry["type"] == "MultiPolygon":
        geometry["coordinates"] = [
            [[coord[::-1] for coord in part] for part in poly] for poly in geometry["coordinates"]
        ]
    return geometry

def transform_geojson():
    # Load input GeoJSON
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Process features
    for feature in data.get("features", []):
        feature["geometry"] = swap_coordinates(feature["geometry"])

    # Write transformed GeoJSON
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Coordinates swapped! Saved to: {OUTPUT_FILE}")

if __name__ == "__main__":
    if os.path.exists(INPUT_FILE):
        transform_geojson()
    else:
        print(f"File '{INPUT_FILE}' not found in the current directory.")
