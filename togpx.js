'use strict';

const { create } = require('xmlbuilder2');
const decodePolyline = require('decode-google-map-polyline');
const fs = require('fs');
const path = require('path');

const GPX_NS       = 'http://www.topografix.com/GPX/1/1';
const XSI_NS       = 'http://www.w3.org/2001/XMLSchema-instance';
const GPXTPX_NS    = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
const GPXX_NS      = 'http://www.garmin.com/xmlschemas/GpxExtensions/v3';
const GPXPX_NS     = 'http://www.garmin.com/xmlschemas/PowerExtension/v1';
const GPX_STYLE_NS = 'http://www.topografix.com/GPX/gpx_style/0/2';

const XSI_SCHEMA_LOCATION = [
  `${GPX_NS} ${GPX_NS}/gpx.xsd`,
  `${GPXX_NS} http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd`,
  `${GPXTPX_NS} http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd`,
  `${GPXPX_NS} http://www.garmin.com/xmlschemas/PowerExtensionv1.xsd`,
  `${GPX_STYLE_NS} ${GPX_STYLE_NS}/gpx_style.xsd`,
].join(' ');

function firstValue(localizedString) {
  return Object.values(localizedString)[0] ?? '';
}

// Haversine distance in km between two {lat, lng} points.
function haversineKm(pointA, pointB) {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRad(pointB.lat - pointA.lat);
  const deltaLng = toRad(pointB.lng - pointA.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(pointA.lat)) * Math.cos(toRad(pointB.lat)) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(haversine));
}

// Elevation polyline encodes lat=elevation(m), lng=normalized distance [0,1].
// Returns an elevation value (m) for each geometry point via linear interpolation.
function interpolateElevations(geoPoints, elevationPoints) {
  const cumulativeDistances = geoPoints.reduce((distances, point, index) => {
    distances.push(index === 0 ? 0 : distances[index - 1] + haversineKm(geoPoints[index - 1], point));
    return distances;
  }, []);
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];

  let elevationIndex = 0;
  return geoPoints.map((_, geoIndex) => {
    const normalizedDistance = cumulativeDistances[geoIndex] / totalDistance;
    while (elevationIndex < elevationPoints.length - 2 && elevationPoints[elevationIndex + 1].lng <= normalizedDistance) {
      elevationIndex++;
    }
    const { lng: distanceBefore, lat: elevationBefore } = elevationPoints[elevationIndex];
    const { lng: distanceAfter, lat: elevationAfter } = elevationPoints[elevationIndex + 1] ?? elevationPoints[elevationIndex];
    if (distanceAfter === distanceBefore) return elevationBefore;
    return elevationBefore + (elevationAfter - elevationBefore) * ((normalizedDistance - distanceBefore) / (distanceAfter - distanceBefore));
  });
}

function routeToGpx(route) {
  const geoPoints        = decodePolyline(route.result.geometry.google);
  const elevationPoints  = decodePolyline(route.result.elevation.google);
  const elevations       = interpolateElevations(geoPoints, elevationPoints);
  const routeName        = firstValue(route.result.name);
  const authorName       = firstValue(route.result.owner.name);

  const gpxRoot = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('gpx', {
      xmlns:                GPX_NS,
      creator:              'StravaGPX',
      version:              '1.1',
      'xmlns:xsi':          XSI_NS,
      'xsi:schemaLocation': XSI_SCHEMA_LOCATION,
      'xmlns:gpxtpx':       GPXTPX_NS,
      'xmlns:gpxx':         GPXX_NS,
      'xmlns:gpxpx':        GPXPX_NS,
      'xmlns:gpx_style':    GPX_STYLE_NS,
    });

  gpxRoot
    .ele('metadata')
      .ele('name').txt(routeName).up()
      .ele('author')
        .ele('name').txt(authorName).up()
        .ele('link', { href: 'https://le.pirlou.it/' });

  const trackSegment = gpxRoot
    .ele('trk')
      .ele('name').txt(routeName).up()
      .ele('type').txt('cycling').up()
      .ele('trkseg');

  geoPoints.forEach(({ lat, lng }, index) => {
    trackSegment.ele('trkpt', { lat, lon: lng })
      .ele('ele').txt(String(Math.round(elevations[index])));
  });

  return gpxRoot.doc().end({ prettyPrint: true });
}

const inputFile = process.argv[2] || 'namur.json';
const route = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf8'));
console.log(routeToGpx(route));
