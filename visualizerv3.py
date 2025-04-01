import geopandas as gpd
import matplotlib.pyplot as plt

# Load GeoJSON data
data = gpd.read_file('transformuotas.geojson')

# Plot the data
fig, ax = plt.subplots(figsize=(10, 10))
data.plot(ax=ax, color='lightblue', edgecolor='black')

# Add labels
for idx, row in data.iterrows():
    geom_type = row.geometry.geom_type
    if geom_type == 'Polygon' or geom_type == 'MultiPolygon':
        x, y = row.geometry.centroid.x, row.geometry.centroid.y
    elif geom_type == 'LineString':
        x, y = row.geometry.interpolate(0.5, normalized=True).x, row.geometry.interpolate(0.5, normalized=True).y
    elif geom_type == 'Point':
        x, y = row.geometry.x, row.geometry.y
    ax.annotate(row['name'], xy=(x, y), fontsize=9, ha='center')

# Configure plot aesthetics
ax.set_title('GeoJSON Data Visualization')
ax.set_xlabel('X Coordinate')
ax.set_ylabel('Y Coordinate')
ax.grid(True)

plt.show()
