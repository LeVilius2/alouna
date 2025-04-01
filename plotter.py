import json
import matplotlib.pyplot as plt
import os

INPUT_FILE = "output_swapped.geojson"

def plot_geometry(geometry):
    geom_type = geometry["type"]
    coords = geometry["coordinates"]

    if geom_type == "Point":
        x, y = coords
        plt.plot(x, y, 'ro')  # red dot

    elif geom_type == "LineString":
        x, y = zip(*coords)
        plt.plot(x, y, 'b-')  # blue line

    elif geom_type == "Polygon":
        for ring in coords:
            x, y = zip(*ring)
            plt.plot(x, y, 'g-')  # green outline

    elif geom_type == "MultiPoint":
        for point in coords:
            x, y = point
            plt.plot(x, y, 'ro')

    elif geom_type == "MultiLineString":
        for line in coords:
            x, y = zip(*line)
            plt.plot(x, y, 'b-')

    elif geom_type == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                x, y = zip(*ring)
                plt.plot(x, y, 'g-')

def plot_geojson():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    plt.figure(figsize=(8, 6))

    for feature in data.get("features", []):
        geometry = feature.get("geometry")
        if geometry:
            plot_geometry(geometry)

    plt.title("GeoJSON Objects in Cartesian Coordinates")
    plt.xlabel("Longitude (X)")
    plt.ylabel("Latitude (Y)")
    plt.grid(True)
    plt.axis('equal')  # Keep proportions
    plt.show()

if __name__ == "__main__":
    if os.path.exists(INPUT_FILE):
        plot_geojson()
    else:
        print(f"File '{INPUT_FILE}' not found in the current directory.")
