import json
import tkinter as tk
from tkinter import filedialog, Canvas

def load_geojson(filepath):
    """Loads GeoJSON data from a file."""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        return data
    except FileNotFoundError:
        print(f"Error: File not found at {filepath}")
        return None
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON format in {filepath}")
        return None

def scale_coordinates(coordinates, canvas_width, canvas_height):
    """Scales Cartesian coordinates to fit the canvas."""
    min_x = min(coord[0] for feature in coordinates for coord in feature)
    max_x = max(coord[0] for feature in coordinates for coord in feature)
    min_y = min(coord[1] for feature in coordinates for coord in feature)
    max_y = max(coord[1] for feature in coordinates for coord in feature)

    width_range = max_x - min_x
    height_range = max_y - min_y

    if width_range == 0 or height_range == 0:
        return [[(canvas_width / 2, canvas_height / 2) for coord in feature] for feature in coordinates]

    x_scale = canvas_width / width_range
    y_scale = canvas_height / height_range

    scaled_coordinates = []
    for feature in coordinates:
        scaled_feature = []
        for x, y in feature:
            scaled_x = (x - min_x) * x_scale
            scaled_y = canvas_height - (y - min_y) * y_scale  # Invert y-axis
            scaled_feature.append((scaled_x, scaled_y))
        scaled_coordinates.append(scaled_feature)

    return scaled_coordinates

def draw_geojson(canvas, features):
    """Draws GeoJSON features on the canvas."""
    if not features:
        return

    all_coordinates = []
    for feature in features:
        if feature['geometry']['type'] == 'Polygon':
            all_coordinates.append(feature['geometry']['coordinates'][0])
        elif feature['geometry']['type'] == 'LineString':
            all_coordinates.append(feature['geometry']['coordinates'])
        elif feature['geometry']['type'] == 'Point':
            all_coordinates.append([feature['geometry']['coordinates']]) #make it compatible with scale_coordinates
        else:
            print(f"Unsupported geometry type: {feature['geometry']['type']}")

    scaled_coordinates = scale_coordinates(all_coordinates, canvas.winfo_width(), canvas.winfo_height())

    for i, feature in enumerate(features):
        if feature['geometry']['type'] == 'Polygon' or feature['geometry']['type'] == 'LineString':
            canvas.create_polygon(scaled_coordinates[i], outline='black', fill='')
        elif feature['geometry']['type'] == 'Point':
            canvas.create_oval(scaled_coordinates[i][0][0]-3, scaled_coordinates[i][0][1]-3, scaled_coordinates[i][0][0]+3, scaled_coordinates[i][0][1]+3, fill="red")

def open_file():
    """Opens a file dialog and loads the selected GeoJSON file."""
    filepath = filedialog.askopenfilename(filetypes=[("GeoJSON files", "*.geojson")])
    if filepath:
        geojson_data = load_geojson(filepath)
        if geojson_data and 'features' in geojson_data:
            canvas.delete("all")  # Clear previous drawings
            draw_geojson(canvas, geojson_data['features'])

# Create the main window
root = tk.Tk()
root.title("GeoJSON Visualizer")

# Create a canvas for drawing
canvas = Canvas(root, width=800, height=600, bg='white')
canvas.pack(expand=tk.YES, fill=tk.BOTH)

# Create a button to open a file
open_button = tk.Button(root, text="Open GeoJSON", command=open_file)
open_button.pack(pady=10)

root.mainloop()