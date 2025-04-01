import json
import matplotlib.pyplot as plt
import os
import numpy as np

INPUT_FILE = "output_swapped.geojson"

plotted_objects = []

def plot_geometry(ax, geometry, name):
    geom_type = geometry["type"]
    coords = geometry["coordinates"]

    def add_object(coords_list):
        try:
            arr = np.array(coords_list, dtype=float)
            if arr.ndim == 1:
                arr = arr.reshape(1, 2)
            plot = ax.plot(arr[:, 0], arr[:, 1], 'o-')[0]
            plotted_objects.append((plot, name, arr))
            print(f"Added: {name} with {arr.shape[0]} points")
        except Exception as e:
            print(f"Failed to add {name}: {e}")

    if geom_type == "Point":
        add_object(coords)

    elif geom_type == "LineString":
        add_object(coords)

    elif geom_type == "Polygon":
        for ring in coords:
            add_object(ring)

    elif geom_type == "MultiPoint":
        for point in coords:
            add_object(point)

    elif geom_type == "MultiLineString":
        for line in coords:
            add_object(line)

    elif geom_type == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                add_object(ring)

def on_click(event):
    if not event.inaxes:
        return

    print(f"Clicked at ({event.xdata}, {event.ydata})")

    if not plotted_objects:
        print("No plotted objects to check!")
        return

    click_pt = np.array([event.xdata, event.ydata])
    closest_obj = None
    min_dist = float('inf')

    for plot, name, vertices in plotted_objects:
        dists = np.linalg.norm(vertices - click_pt, axis=1)
        closest = dists.min()
        if closest < min_dist:
            min_dist = closest
            closest_obj = (name, vertices)

    if closest_obj and min_dist < 0.05:
        name, vertices = closest_obj
        print(f"\n---\nClicked on: {name}")
        for v in vertices:
            print(f"  {v}")
        print("---\n")
    else:
        print("No object near click.")

def plot_geojson():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    fig, ax = plt.subplots(figsize=(8, 6))

    features = data.get("features", [])
    print(f"Total features: {len(features)}")

    for idx, feature in enumerate(features):
        geometry = feature.get("geometry")
        name = feature.get("properties", {}).get("name", f"Object {idx}")
        if geometry:
            plot_geometry(ax, geometry, name)

    print(f"Total plotted objects: {len(plotted_objects)}")

    fig.canvas.mpl_connect('button_press_event', on_click)

    ax.set_title("GeoJSON Viewer (Click Enabled)")
    ax.axis("equal")
    ax.grid(True)
    plt.show()

if __name__ == "__main__":
    if os.path.exists(INPUT_FILE):
        plot_geojson()
    else:
        print(f"File '{INPUT_FILE}' not found in the current directory.")
