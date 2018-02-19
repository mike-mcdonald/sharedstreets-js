import bearing from "@turf/bearing";
import distance from "@turf/distance";
import { Coord, Feature, lineString, LineString, Point } from "@turf/helpers";
import { getCoord } from "@turf/invariant";
import lineOffset from "@turf/line-offset";
import BigNumber from "bignumber.js";
import { createHash } from "crypto";
import {
  FormOfWay, GISMetadata, LocationReference, OSMMetadata,
  SharedStreetsGeometry, SharedStreetsIntersection, SharedStreetsMetadata, SharedStreetsReference,
} from "sharedstreets-types";
import { isArray } from "util";

/**
 * Shared Streets Java implementation
 *
 * @private
 * Intersection
 * https://github.com/sharedstreets/sharedstreets-builder/blob/master/src/main/java/io/sharedstreets/data/SharedStreetsIntersection.java#L42-L49
 *
 * Geometry
 * https://github.com/sharedstreets/sharedstreets-builder/blob/master/src/main/java/io/sharedstreets/data/SharedStreetsGeometry.java#L98-L108
 *
 * Reference
 * https://github.com/sharedstreets/sharedstreets-builder/blob/master/src/main/java/io/sharedstreets/data/SharedStreetsReference.java#L323-L340
 *
 * Location Reference
 * https://github.com/sharedstreets/sharedstreets-builder/blob/master/src/main/java/io/sharedstreets/data/SharedStreetsLocationReference.java
 *
 * OpenLR White Paper
 * http://www.openlr.org/data/docs/OpenLR-Whitepaper_v1.5.pdf
 */

/**
 * Geometry Id
 *
 * @param {Feature<LineString>|Array<Array<number>>} line Line Geometry as a GeoJSON LineString or an Array of Positions Array<<longitude, latitude>>.
 * @returns {string} SharedStreets Geometry Id
 * @example
 * const id = sharedstreets.geometryId([[110, 45], [115, 50], [120, 55]]);
 * id // => "ce9c0ec1472c0a8bab3190ab075e9b21"
 */
export function geometryId(line: Feature<LineString> | LineString | number[][]): string {
  const message = geometryMessage(line);
  return generateHash(message);
}

/**
 * Geometry Message
 *
 * @private
 */
export function geometryMessage(line: Feature<LineString> | LineString | number[][]): string {
  const coords = getCoords(line);
  return "Geometry " + coords.map(([x, y]) => `${round(x)} ${round(y)}`).join(" ");
}

/**
 * geometry
 *
 * @param {Feature<LineString>|Array<Array<number>>} line GeoJSON LineString Feature
 * @param {Object} [options={}] Optional parameters
 * @param {string} [options.formOfWay] Property field that contains FormOfWay value (number/string).
 * @param {string} [options.roadClass] Property field that contains RoadClass value (number/string).
 * @returns {SharedStreetsGeometry} SharedStreets Geometry
 * @example
 * const line = [[110, 45], [115, 50], [120, 55]];
 * const geom = sharedstreets.geometry(line);
 * geom.id; // => "ce9c0ec1472c0a8bab3190ab075e9b21"
 * geom.lonlats; // => [ 110, 45, 115, 50, 120, 55 ]
 */
export function geometry(line: Feature<LineString> | LineString | number[][], options: {
  formOfWay?: string,
  roadClass?: string,
  // To-Do
  // - fromIntersection [optional]
  // - toIntersection [optional]
  // - forwardReference [optional]
  // - backReference [optional]
} = {}): SharedStreetsGeometry {
  let properties: any = {};
  const coords = getCoords(line);

  // Extract Properties from GeoJSON LineString Feature
  if (!isArray(line) && line.type === "Feature") { properties = line.properties || {}; }

  // Attributes for Forward & Back References
  const start = coords[0];
  const end = coords[coords.length - 1];
  const distToNextRef = distanceToNextRef(start, end);
  const outBearing = outboundBearing(line);
  const inBearing = inboundBearing(line);

  // FormOfWay needs to be extracted from the GeoJSON properties.
  let formOfWay = 0;
  if (options.formOfWay && properties[options.formOfWay]) {
    formOfWay = properties[options.formOfWay];
  }

  // RoadClass needs to be extracted from the GeoJSON properties.
  let roadClass = "Other";
  if (options.roadClass && properties[options.roadClass]) {
    roadClass = properties[options.roadClass];
  }

  // To-Do make below from Optional parameters
  // Location References
  const fromIntersection = locationReference(start, {
    distanceToNextRef: distToNextRef,
    outboundBearing: outBearing,
  });
  const toIntersection = locationReference(end, {
    inboundBearing: inBearing,
  });
  const fromIntersectionId = fromIntersection.intersectionId;
  const toIntersectionId = toIntersection.intersectionId;

  // Forward/Back Reference
  const forwardReferenceId = referenceId([fromIntersection, toIntersection], formOfWay);
  const backReferenceId = referenceId([toIntersection, fromIntersection], formOfWay);

  // Save Results
  const id = geometryId(line);
  const lonlats = coordsToLonlats(coords);

  return {
    id,
    fromIntersectionId,
    toIntersectionId,
    forwardReferenceId,
    backReferenceId,
    roadClass,
    lonlats,
  };
}

/**
 * Intersection Id
 *
 * @param {Feature<Point>|Array<number>} pt Point location reference as a GeoJSON Point or an Array of numbers <longitude, latitude>.
 * @returns {string} SharedStreets Intersection Id
 * @example
 * const id = sharedstreets.intersectionId([110, 45]);
 * id // => "71f34691f182a467137b3d37265cb3b6"
 */
export function intersectionId(pt: number[] | Feature<Point> | Point): string {
  const message = intersectionMessage(pt);
  return generateHash(message);
}

/**
 * Intersection Message
 *
 * @private
 */
export function intersectionMessage(pt: number[] | Feature<Point> | Point): string {
  const [lon, lat] = getCoord(pt);
  return `Intersection ${round(lon)} ${round(lat)}`;
}

/**
 * Intersection
 *
 * @param {Feature<Point>|Array<number>} pt Point location reference as a GeoJSON Point or an Array of numbers <longitude, latitude>.
 * @param {Object} [options={}] Optional parameters
 * @param {string} [options.nodeId] Define NodeId for Intersection
 * @returns {SharedStreetsIntersection} SharedStreets Intersection
 * @example
 * const intersection = sharedstreets.intersection([110, 45]);
 * intersection.id // => "71f34691f182a467137b3d37265cb3b6"
 */
export function intersection(pt: number[] | Feature<Point> | Point, options: {
  nodeId?: string,
  inboundReferences?: LocationReference[],
  outboundReferencesIds?: LocationReference[],
} = {}): SharedStreetsIntersection {
  // Default params
  const inboundReferences = options.inboundReferences || [];
  const outboundReferences = options.outboundReferencesIds || [];
  const nodeId = options.nodeId || "";

  // Main
  const [lon, lat] = getCoord(pt);
  const id = intersectionId(pt);
  const inboundReferenceIds = inboundReferences.map((ref) => ref.intersectionId);
  const outboundReferenceIds = outboundReferences.map((ref) => ref.intersectionId);

  return {
    id,
    nodeId,
    lon,
    lat,
    inboundReferenceIds,
    outboundReferenceIds,
  };
}

/**
 * Reference Id
 *
 * @param {Array<LocationReference>} locationReferences An Array of Location References.
 * @param {FormOfWay} [formOfWay=0] Form Of Way
 * @returns {string} SharedStreets Reference Id
 * @example
 * const locationReferences = [
 *   sharedstreets.locationReference([-74.0048213, 40.7416415], {outboundBearing: 208, distanceToNextRef: 9279}),
 *   sharedstreets.locationReference([-74.0051265, 40.7408505], {inboundBearing: 188})
 * ];
 * const formOfWay = 2; // => "MultipleCarriageway"
 *
 * const id = sharedstreets.referenceId(locationReferences, formOfWay);
 * id // => "ef209661aeebadfb4e0a2cb93153493f"
 */
export function referenceId(
  locationReferences: LocationReference[],
  formOfWay = FormOfWay.Other,
): string {
  const message = referenceMessage(locationReferences, formOfWay);
  return generateHash(message);
}

/**
 * Reference Message
 *
 * @private
 */
export function referenceMessage(
  locationReferences: LocationReference[],
  formOfWay = FormOfWay.Other,
): string {
  // Convert FormOfWay to Number if encoding ID
  if (typeof formOfWay !== "number") { formOfWay = getFormOfWayNumber(formOfWay); }

  let message = `Reference ${formOfWay}`;
  locationReferences.forEach((lr) => {
    message += ` ${round(lr.lon)} ${round(lr.lat)}`;
    if (lr.outboundBearing !== null && lr.outboundBearing !== undefined &&
        lr.distanceToNextRef !== null && lr.distanceToNextRef !== undefined) {
      message += ` ${Math.floor(lr.outboundBearing)}`;
      message += ` ${Math.floor(lr.distanceToNextRef)}`; // distanceToNextRef must be stored in centimeter
    }
  });
  return message;
}

/**
 * Reference
 *
 * @param {SharedStreetsGeometry} geom SharedStreets Geometry
 * @param {Array<LocationReference>} locationReferences An Array of Location References.
 * @param {number} [formOfWay=0] Form Of Way (default Other)
 * @param {}
 * @returns {SharedStreetsReference} SharedStreets Reference
 * @example
 * const line = [[110, 45], [115, 50], [120, 55]];
 * const geom = sharedstreets.geometry(line);
 * const locationReferences = [
 *   sharedstreets.locationReference([-74.0048213, 40.7416415], {outboundBearing: 208, distanceToNextRef: 9279}),
 *   sharedstreets.locationReference([-74.0051265, 40.7408505], {inboundBearing: 188}),
 * ];
 * const formOfWay = 2; // => "MultipleCarriageway"
 * const ref = sharedstreets.reference(geom, locationReferences, formOfWay);
 * ref.id // => "ef209661aeebadfb4e0a2cb93153493f"
 */
export function reference(
  geom: SharedStreetsGeometry,
  locationReferences: LocationReference[],
  formOfWay = FormOfWay.Other,
): SharedStreetsReference {
  return {
    id: referenceId(locationReferences, formOfWay),
    geometryId: geom.id,
    formOfWay,
    locationReferences,
  };
}

/**
 * Location Reference
 *
 * @private
 * @param {Feature<Point>|Array<number>} pt Point as a GeoJSON Point or an Array of numbers <longitude, latitude>.
 * @param {Object} [options={}] Optional parameters
 * @param {string} [options.intersectionId] Intersection Id - Fallbacks to input's point `id` or generates Intersection Id.
 * @param {number} [options.inboundBearing] Inbound bearing of the street geometry for the 20 meters immediately following the location reference.
 * @param {number} [options.outboundBearing] Outbound bearing.
 * @param {number} [options.distanceToNextRef] Distance to next Location Reference (distance must be defined in centimeters).
 * @returns {LocationReference} SharedStreets Location Reference
 * @example
 * const options = {
 *   outboundBearing: 208,
 *   distanceToNextRef: 9279
 * };
 * const locRef = sharedstreets.locationReference([-74.00482177734375, 40.741641998291016], options);
 * locRef.intersectionId // => "5c88d4fa3900a083355c46c54da8f584"
 */
export function locationReference(
  pt: number[] | Feature<Point> | Point,
  options: {
    intersectionId?: string,
    inboundBearing?: number,
    outboundBearing?: number,
    distanceToNextRef?: number,
} = {}): LocationReference {
  const coord = getCoord(pt);
  const id = options.intersectionId || intersectionId(coord);

  // Include extra properties & Reference ID to GeoJSON Properties
  const locRef: LocationReference = {
    intersectionId: id,
    lat: coord[1],
    lon: coord[0],
  };
  if (options.inboundBearing) { locRef.inboundBearing = options.inboundBearing; }
  if (options.outboundBearing) { locRef.outboundBearing = options.outboundBearing; }
  if (options.distanceToNextRef) { locRef.distanceToNextRef = options.distanceToNextRef; }

  if (locRef.outboundBearing !== undefined && locRef.distanceToNextRef === undefined) {
    throw new Error("distanceToNextRef is required if outboundBearing is present");
  }
  return locRef;
}

/**
 * Metadata
 *
 * @param {SharedStreetsGeometry} geom SharedStreets Geometry
 * @param {OSMMetadata} [osmMetadata={}] OSM Metadata
 * @param {Array<GISMetadata>} [gisMetadata=[]] GIS Metadata
 * @param {}
 * @returns {SharedStreetsMetadata} SharedStreets Metadata
 * @example
 * const line = [[110, 45], [115, 50], [120, 55]];
 * const geom = sharedstreets.geometry(line);
 * const metadata = sharedstreets.metadata(geom)
 */
export function metadata(
  geom: SharedStreetsGeometry,
  osmMetadata: OSMMetadata = {},
  gisMetadata: GISMetadata[] = [],
): SharedStreetsMetadata {
  return {
    geometryId: geom.id,
    osmMetadata,
    gisMetadata,
  };
}

/**
 * Calculates outbound bearing from a LineString
 *
 * @param {Feature<LineString>|Array<Array<number>>} line GeoJSON LineString or an Array of Positions
 * @returns {number} Outbound Bearing
 * @example
 * const line = [[110, 45], [115, 50], [120, 55]];
 * const outboundBearing = sharedstreets.outboundBearing(line);
 * outboundBearing; // => 208
 */
export function outboundBearing(line: Feature<LineString>|LineString|number[][]): number {
  const coords = getCoords(line);
  // Calculate Distances
  const start = coords[0];

  // LRs describe the compass bearing of the street geometry for the 20 meters immediately following the LR.
  const line20m = lineOffset(lineString(coords), 20, {units: "meters"});
  const line20mCoords = getCoords(line20m);
  const start20m = line20mCoords[line20mCoords.length - 1];

  // Calculate outbound & inbound
  return bearing(start, start20m);
}

/**
 * Calculates inbound bearing from a LineString
 *
 * @param {Feature<LineString>|Array<Array<number>>} line GeoJSON LineString or an Array of Positions
 * @returns {number} Inbound Bearing
 * @example
 * const line = [[110, 45], [115, 50], [120, 55]];
 * const inboundBearing = sharedstreets.inboundBearing(line);
 * inboundBearing; // => 188
 */
export function inboundBearing(line: Feature<LineString>|LineString|number[][]): number {
  const coords = getCoords(line);
  const start = coords[0];
  const end = coords[coords.length - 1];

  return bearing(end, start);
}

/**
 * Calculates inbound bearing from a LineString
 *
 * @param {Coord} start GeoJSON Point or an Array of numbers [Longitude/Latitude]
 * @param {Coord} end GeoJSON Point or an Array of numbers [Longitude/Latitude]
 * @returns {number} Distance to next Ref in centimeters
 * @example
 * const start = [110, 45];
 * const end = [120, 55];
 * const distanceToNextRef = sharedstreets.distanceToNextRef(start, end);
 * distanceToNextRef; // => 9279
 */
export function distanceToNextRef(start: Coord, end: Coord): number {
  return distance(start, end, {units: "meters"}) / 100;
}

/**
 * Converts lonlats to GeoJSON LineString Coords
 *
 * @param {Array<number>} lonlats Single Array of paired longitudes & latitude
 * @returns {Array<Array<number>>}  GeoJSON LineString coordinates
 * @example
 * const coords = lonlatsToCoords([110, 45, 120, 55]);
 * coords // => [[110, 45], [120, 55]]
 */
export function lonlatsToCoords(lonlats: number[]) {
  const coords: number[][] = [];
  lonlats.reduce((lon, deg, index) => {
    if (index % 2 === 0) { return deg; } // Longitude
    coords.push([lon, deg]);
    return deg; // Latitude
  });
  return coords;
}

/**
 * Converts GeoJSON LineString Coords to lonlats
 *
 * @param {Array<Array<number, number>>} coords GeoJSON LineString coordinates
 * @returns {Array<number>} lonlats Single Array of paired longitudes & latitude
 * @example
 * const lonlats = coordsToLonlats([[110, 45], [120, 55]]);
 * lonlats // => [110, 45, 120, 55]
 */
export function coordsToLonlats(coords: number[][]) {
  const lonlats: number[] = [];
  coords.forEach((coord) => {
    lonlats.push(coord[0], coord[1]);
  });
  return lonlats;
}

/**
 * Generates Base16 Hash
 *
 * @param {string} message Message to hash
 * @returns {string} SharedStreets Reference ID
 * @example
 * const message = "Intersection -74.00482177734375 40.741641998291016";
 * const hash = sharedstreets.generateHash(message);
 * hash // => "69f13f881649cb21ee3b359730790bb9"
 */
export function generateHash(message: string): string {
  return createHash("md5").update(message).digest("hex");
}

/**
 * Get RoadClass from a Number to a String
 *
 * @param {number} value Number value [between 0-8]
 * @returns {string} Road Class
 * @example
 * sharedstreets.getRoadClassString(0); // => "Motorway"
 * sharedstreets.getRoadClassString(5); // => "Residential"
 */
export function getRoadClassString(value: number) {
  switch (value) {
    case 0: return "Motorway";
    case 1: return "Trunk";
    case 2: return "Primary";
    case 3: return "Secondary";
    case 4: return "Tertiary";
    case 5: return "Residential";
    case 6: return "Unclassified";
    case 7: return "Service";
    case 8: return "Other";
    default: throw new Error(`[${value}] unknown RoadClass Number value`);
  }
}

/**
 * Get RoadClass from a String to a Number
 *
 * @param {number} value String value ["Motorway", "Trunk", "Primary", etc...]
 * @returns {string} Road Class
 * @example
 * sharedstreets.getRoadClassNumber("Motorway"); // => 0
 * sharedstreets.getRoadClassNumber("Residential"); // => 5
 */
export function getRoadClassNumber(value: string) {
  switch (value) {
    case "Motorway": return 0;
    case "Trunk": return 1;
    case "Primary": return 2;
    case "Secondary": return 3;
    case "Tertiary": return 4;
    case "Residential": return 5;
    case "Unclassified": return 6;
    case "Service": return 7;
    case "Other": return 8;
    default: throw new Error(`[${value}] unknown RoadClass String value`);
  }
}

/**
 * Get FormOfWay from a Number to a String
 *
 * @param {number} value Number value [between 0-7]
 * @returns {string} Form of Way
 * @example
 * sharedstreets.getFormOfWayString(0); // => "Undefined"
 * sharedstreets.getFormOfWayString(5); // => "TrafficSquare"
 */
export function getFormOfWayString(value: number): string {
  switch (value) {
    case undefined:
    case 0: return "Undefined";
    case 1: return "Motorway";
    case 2: return "MultipleCarriageway";
    case 3: return "SingleCarriageway";
    case 4: return "Roundabout";
    case 5: return "TrafficSquare";
    case 6: return "SlipRoad";
    case 7: return "Other";
    default: throw new Error(`[${value}] unknown FormOfWay Number value`);
  }
}

/**
 * Get FormOfWay from a String to a Number
 *
 * @param {number} value String value [ex: "Undefined", "Motorway", etc...]
 * @returns {number} Form of Way
 * @example
 * sharedstreets.getFormOfWayNumber("Undefined"); // => 0
 * sharedstreets.getFormOfWayNumber("TrafficSquare"); // => 5
 */
export function getFormOfWayNumber(value: string) {
  switch (value) {
    case undefined:
    case "Undefined": return 0;
    case "Motorway": return 1;
    case "MultipleCarriageway": return 2;
    case "SingleCarriageway": return 3;
    case "Roundabout": return 4;
    case "TrafficSquare": return 5;
    case "SlipRoad": return 6;
    case "Other": return 7;
    default: throw new Error(`[${value}] unknown FormOfWay String value`);
  }
}

/**
 * getCoords
 *
 * @param {Feature<LineString>|Array<Array<number>>} line GeoJSON LineString or an Array of positions
 * @returns {Array<Array<number>>} Array of positions
 * @example
 * const line = turf.lineString([[110, 45], [115, 50], [120, 55]]);
 * const coords = sharedstreets.getCoords(line);
 * coords; // => [[110, 45], [115, 50], [120, 55]]
 */
export function getCoords(line: Feature<LineString> | LineString | number[][]): number[][] {
  // Deconstruct GeoJSON LineString
  let coords: number[][];
  if (isArray(line)) {
    coords = line;
  } else if (line.type === "Feature") {
    if (line.geometry === null) { throw new Error("line geometry cannot be null"); }
    coords = line.geometry.coordinates;
  } else {
    coords = line.coordinates;
  }
  return coords;
}

/**
 * Round
 *
 * @private
 * @param {number} num Number to round
 * @param {number} [decimalPlaces=6] Decimal Places
 */
export function round(num: number, decimalPlaces = 6) {
  return new BigNumber(String(num)).toFixed(decimalPlaces);
}
