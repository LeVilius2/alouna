<?php

// Include the provided conversion functions from your existing script
include_once('wgs2lks.php');

// Function to recursively convert coordinates
function convertCoordinates($coordinates) {
    if (is_numeric($coordinates[0]) && is_numeric($coordinates[1])) {
        // Convert single coordinate pair
        return geo2grid($coordinates[1], $coordinates[0]); // geo2grid expects (lat, lon)
    } else {
        // Recursively convert nested coordinates
        return array_map('convertCoordinates', $coordinates);
    }
}

// Load the GeoJSON file
$input_geojson = 'cordinate.geojson';
$output_geojson = 'converted_cordinate.geojson';

$geojson_data = json_decode(file_get_contents($input_geojson), true);

if (!$geojson_data) {
    die("Failed to parse GeoJSON file.");
}

// Convert coordinates
foreach ($geojson_data['features'] as &$feature) {
    $geometry = &$feature['geometry'];
    $geometry['coordinates'] = convertCoordinates($geometry['coordinates']);
}

// Save the converted coordinates to a new GeoJSON file
file_put_contents($output_geojson, json_encode($geojson_data, JSON_PRETTY_PRINT));

echo "Coordinates converted successfully to LKS94. Saved in: $output_geojson";

?>
