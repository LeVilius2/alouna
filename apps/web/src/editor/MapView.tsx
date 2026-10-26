import { useEffect, useRef } from 'react';
import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { CategoryRule, Geometry, LonLat } from '@alouna/core';
import { circlePolygonToPoint, type EffectiveFeature } from './state';

export type BasemapId = 'orthophoto' | 'esri' | 'osm';
export type DrawTool = 'pan' | 'select' | 'point' | 'circle' | 'line' | 'polygon';

const BASEMAPS: Record<BasemapId, { tiles: string[]; attribution: string; maxzoom: number }> = {
  orthophoto: {
    tiles: [
      'https://www.geoportal.lt/arcgis/rest/services/NZT/ORT10LT_Web_Mercator_102100/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image',
    ],
    attribution: '© NŽT ORT10LT, geoportal.lt',
    maxzoom: 21,
  },
  esri: {
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri',
    maxzoom: 19,
  },
  osm: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    maxzoom: 19,
  },
};

function makeStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      orthophoto: {
        type: 'raster',
        tiles: BASEMAPS.orthophoto.tiles,
        tileSize: 256,
        attribution: BASEMAPS.orthophoto.attribution,
        maxzoom: BASEMAPS.orthophoto.maxzoom,
      },
      esri: {
        type: 'raster',
        tiles: BASEMAPS.esri.tiles,
        tileSize: 256,
        attribution: BASEMAPS.esri.attribution,
        maxzoom: BASEMAPS.esri.maxzoom,
      },
      osm: {
        type: 'raster',
        tiles: BASEMAPS.osm.tiles,
        tileSize: 256,
        attribution: BASEMAPS.osm.attribution,
        maxzoom: BASEMAPS.osm.maxzoom,
      },
      'alouna-features': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      {
        id: 'base-orthophoto',
        type: 'raster',
        source: 'orthophoto',
        layout: { visibility: 'visible' },
      },
      { id: 'base-esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
      { id: 'base-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
      {
        id: 'features-fill',
        type: 'fill',
        source: 'alouna-features',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#888888'],
          'fill-opacity': ['case', ['==', ['get', 'enabled'], false], 0.12, 0.3],
        },
      },
      {
        id: 'features-outline',
        type: 'line',
        source: 'alouna-features',
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'selected'], true],
            '#ffd60a',
            ['coalesce', ['get', 'color'], '#888888'],
          ],
          'line-width': ['case', ['==', ['get', 'selected'], true], 4, 2.5],
        },
      },
      {
        id: 'features-point',
        type: 'circle',
        source: 'alouna-features',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], true], 9, 7],
          'circle-color': ['coalesce', ['get', 'color'], '#0a84ff'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#ffd60a', '#ffffff'],
        },
      },
    ],
  };
}

function allLonLats(geom: Geometry): readonly LonLat[] {
  return geom.type === 'Point'
    ? [geom.coordinates]
    : geom.type === 'LineString'
      ? geom.coordinates
      : geom.coordinates.flat();
}

export function MapView({
  features,
  rules,
  hiddenCategories,
  showDisabled,
  showDeleted,
  selectedId,
  basemap,
  tool,
  fitTrigger,
  onSelect,
  onCreateFromDraw,
  onGeometryDraft,
}: {
  features: readonly EffectiveFeature[];
  rules: readonly CategoryRule[];
  hiddenCategories: ReadonlySet<string>;
  showDisabled: boolean;
  showDeleted: boolean;
  selectedId: string | null;
  basemap: BasemapId;
  tool: DrawTool;
  fitTrigger: number;
  onSelect: (id: string | null) => void;
  onCreateFromDraw: (geometry: Geometry, radius_m?: number) => void;
  onGeometryDraft: (geometry: Geometry) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const readyRef = useRef(false);
  const didInitialFitRef = useRef(false);
  const callbacksRef = useRef({ onSelect, onCreateFromDraw, onGeometryDraft, tool, selectedId });
  useEffect(() => {
    callbacksRef.current = { onSelect, onCreateFromDraw, onGeometryDraft, tool, selectedId };
  }, [onSelect, onCreateFromDraw, onGeometryDraft, tool, selectedId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let map: MapLibreMap | null = null;
    let draw: TerraDraw | null = null;
    try {
      map = new MapLibreMap({
        container: el,
        style: makeStyle(),
        center: [25.6953, 55.6363],
        zoom: 17,
      });
      mapRef.current = map;
      map.on('load', () => {
        if (!map) return;
        readyRef.current = true;
        try {
          const selectFlags = {
            feature: {
              draggable: true,
              coordinates: { midpoints: true, draggable: true, deletable: true },
            },
          };
          draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map }),
            modes: [
              new TerraDrawSelectMode({
                flags: {
                  point: selectFlags,
                  linestring: selectFlags,
                  polygon: selectFlags,
                  circle: selectFlags,
                },
              }),
              new TerraDrawPointMode(),
              new TerraDrawLineStringMode(),
              new TerraDrawPolygonMode(),
              new TerraDrawCircleMode(),
            ],
          });
          draw.start();
          drawRef.current = draw;
          draw.on('finish', (id) => {
            const snap = draw?.getSnapshotFeature(id);
            if (!snap) return;
            const currentTool = callbacksRef.current.tool;
            if (currentTool === 'select') {
              callbacksRef.current.onGeometryDraft(snap.geometry as unknown as Geometry);
              return;
            }
            draw?.removeFeatures([id]);
            const geom = snap.geometry as unknown as Geometry;
            if (currentTool === 'circle') {
              const circle = circlePolygonToPoint(geom);
              if (circle) {
                callbacksRef.current.onCreateFromDraw(
                  { type: 'Point', coordinates: circle.point },
                  circle.radius_m,
                );
                return;
              }
            }
            callbacksRef.current.onCreateFromDraw(geom);
          });
        } catch {
          /* Non-WebGL test environment: drawing stays disabled. */
        }

        for (const layer of ['features-point', 'features-outline', 'features-fill']) {
          map.on('click', layer, (e: MapLayerMouseEvent) => {
            if (callbacksRef.current.tool !== 'pan' && callbacksRef.current.tool !== 'select')
              return;
            const fid = e.features?.[0]?.properties?.id as string | undefined;
            if (fid) callbacksRef.current.onSelect(fid);
          });
        }
      });
    } catch {
      /* jsdom has no WebGL context; the rest of the editor still works and is tested. */
    }
    return () => {
      readyRef.current = false;
      try {
        draw?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      try {
        map?.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
  }, []);

  // Switch basemap visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    for (const id of ['orthophoto', 'esri', 'osm'] as const) {
      if (map.getLayer(`base-${id}`)) {
        map.setLayoutProperty(`base-${id}`, 'visibility', id === basemap ? 'visible' : 'none');
      }
    }
  }, [basemap]);

  // Switch Terra Draw mode and load the selected feature for vertex editing.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.clear();
      if (tool === 'pan') {
        draw.setMode('static');
      } else if (tool === 'select') {
        draw.setMode('select');
        const sel = features.find((f) => f.feature.id === selectedId);
        if (sel) {
          const modeName =
            sel.feature.geometry.type === 'Point'
              ? 'point'
              : sel.feature.geometry.type === 'LineString'
                ? 'linestring'
                : 'polygon';
          const storeFeature: GeoJSONStoreFeatures = {
            id: sel.feature.id,
            type: 'Feature',
            geometry: sel.feature.geometry as unknown as GeoJSONStoreFeatures['geometry'],
            properties: { mode: modeName },
          };
          draw.addFeatures([storeFeature]);
          draw.selectFeature(sel.feature.id);
        }
      } else if (tool === 'point') {
        draw.setMode('point');
      } else if (tool === 'circle') {
        draw.setMode('circle');
      } else if (tool === 'line') {
        draw.setMode('linestring');
      } else if (tool === 'polygon') {
        draw.setMode('polygon');
      }
    } catch {
      /* ignore mode errors in headless tests */
    }
  }, [tool, selectedId, features]);

  // Update the GeoJSON source whenever features/rules/filters change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const colorByCat = new Map(rules.map((r) => [r.category, r.color]));
    const visible = features.filter((item) => {
      const p = item.feature.properties;
      if (hiddenCategories.has(p.category)) return false;
      if (!showDisabled && p.enabled === false) return false;
      if (!showDeleted && item.status === 'deleted') return false;
      return true;
    });
    const src = map.getSource('alouna-features') as GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: visible.map((item) => ({
        type: 'Feature',
        id: item.feature.id,
        geometry: item.feature.geometry as unknown as GeoJSON.Geometry,
        properties: {
          id: item.feature.id,
          name: item.feature.properties.name ?? '',
          category: item.feature.properties.category,
          enabled: item.feature.properties.enabled !== false,
          status: item.status,
          color: colorByCat.get(item.feature.properties.category) ?? '#0a84ff',
          selected: item.feature.id === selectedId,
        },
      })),
    });

    if (!didInitialFitRef.current && visible.length > 0) {
      didInitialFitRef.current = true;
      fitFeatures(map, visible);
    }
  }, [features, rules, hiddenCategories, showDisabled, showDeleted, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || fitTrigger === 0) return;
    fitFeatures(
      map,
      features.filter((f) => f.status !== 'deleted'),
    );
  }, [fitTrigger, features]);

  return <div ref={containerRef} className="editor-map" role="region" aria-label="Property map" />;
}

function fitFeatures(map: MapLibreMap, items: readonly EffectiveFeature[]): void {
  const pts = items.flatMap((i) => allLonLats(i.feature.geometry));
  if (!pts.length) return;
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  try {
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 40, maxZoom: 19, duration: 0 },
    );
  } catch {
    /* ignore */
  }
}
