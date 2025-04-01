import json
import os

def transform_coordinates(geojson_file, reference_x, reference_y):
    """
    Transforms GeoJSON coordinates to distances relative to a reference point.

    Args:
        geojson_file (str): Path to the GeoJSON file.
        reference_x (float): X-coordinate of the reference point.
        reference_y (float): Y-coordinate of the reference point.

    Returns:
        dict: A new GeoJSON dictionary with transformed coordinates, or None if an error occurred.
    """
    try:
        with open(geojson_file, 'r') as f:
            data = json.load(f)

        if 'features' not in data:
            print("Error: GeoJSON file does not contain 'features' array.")
            return None

        for feature in data['features']:
            if 'geometry' in feature and 'coordinates' in feature['geometry']:
                geometry_type = feature['geometry']['type']
                coordinates = feature['geometry']['coordinates']

                if geometry_type == 'Point':
                    x, y = coordinates
                    feature['geometry']['coordinates'] = [x - reference_x, y - reference_y]
                elif geometry_type == 'LineString':
                    transformed_coords = [[x - reference_x, y - reference_y] for x, y in coordinates]
                    feature['geometry']['coordinates'] = transformed_coords
                elif geometry_type == 'Polygon':
                    transformed_coords = [[[x - reference_x, y - reference_y] for x, y in ring] for ring in coordinates]
                    feature['geometry']['coordinates'] = transformed_coords
                elif geometry_type == 'MultiPolygon':
                    transformed_coords = [[[[x-reference_x, y-reference_y] for x,y in ring] for ring in polygon] for polygon in coordinates]
                    feature['geometry']['coordinates'] = transformed_coords
                elif geometry_type == 'MultiLineString':
                    transformed_coords = [[[x - reference_x, y - reference_y] for x, y in line] for line in coordinates]
                    feature['geometry']['coordinates'] = transformed_coords
                else:
                    print(f"Unsupported geometry type: {geometry_type}")

        return data

    except FileNotFoundError:
        print(f"Error: File not found at {geojson_file}")
        return None
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON format in {geojson_file}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None

def save_geojson(transformed_data, output_file):
    """Saves transformed GeoJSON data to a file."""
    if transformed_data:
        try:
            os.makedirs(os.path.dirname(output_file), exist_ok=True) #create directory if does not exist.
            with open(output_file, 'w') as f:
                json.dump(transformed_data, f, indent=2)
            print(f"Transformed GeoJSON data saved to {output_file}")
        except Exception as e:
            print(f"Error saving to {output_file}: {e}")

# Example usage:
input_geojson_file = "lkscoord.geojson"  # Replace with your input file
output_geojson_file = "output_folder/transformed_output.geojson" # Replace with your output file
reference_x = 6168029
reference_y = 606645

transformed_data = transform_coordinates(input_geojson_file, reference_x, reference_y)
save_geojson(transformed_data, output_geojson_file)