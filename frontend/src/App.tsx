import mapboxgl from "mapbox-gl";
import MapboxMatrix from "@mapbox/mapbox-sdk/services/matrix";
import { SearchBox } from "@mapbox/search-js-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "mapbox-gl/dist/mapbox-gl.css";

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN!;
mapboxgl.accessToken = accessToken;

const DEFAULT_PLACE_NAME = "A cool place";

type LatLon = {
  lat: number;
  lon: number;
};

const matrixClient = MapboxMatrix({ accessToken });

const fetchMapBoxDirectionsMatrix = async (
  locations: LatLon[],
  profile: TransportProfile
) => {
  const matrixResponse = await matrixClient
    .getMatrix({
      profile: profile,
      annotations: ["duration", "distance"],
      points: locations.map((l) => {
        return { coordinates: [l.lon, l.lat] };
      }),
    })
    .send();
  if (matrixResponse.statusCode !== 200) {
    throw new Error(
      `HTTP error from MapBox! status: ${matrixResponse.statusCode}`
    );
  }
  return matrixResponse.body;
};

type PointOfInterest = {
  id: string;
  name: string;
  location: Location;
  note?: string;
  url?: string;
};

type PlaceToStay = {
  id: string;
  name: string;
  location: Location;
  note?: string;
  url?: string;
  averageDistance?: number;
  cumulativeDistance?: number;
  averageTime?: number;
  cumulativeTime?: number;
  distancesToPOIs?: { [poiId: string]: { distance: number; duration: number } };
};

type Location = {
  coordinates: LatLon;
  address: string;
  placeName?: string;
};

type DistanceCalculationMode = "average" | "cumulative";
type TransportProfile = "walking" | "driving-traffic" | "cycling";

type AppState = {
  pointsOfInterest: PointOfInterest[];
  placesToStay: PlaceToStay[];
  distanceMode: DistanceCalculationMode;
  transportProfile: TransportProfile;
  mapCenter?: { lng: number; lat: number } | null | undefined;
  mapZoom?: number | null | undefined;
};

function App() {
  const mapContainerRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchedLocation, setSearchedLocation] = useState<Location | null>(
    null
  );

  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>(
    []
  );
  const [placesToStay, setPlacesToStay] = useState<PlaceToStay[]>([]);
  const [distanceMode, setDistanceMode] =
    useState<DistanceCalculationMode>("average");
  const [transportProfile, setTransportProfile] =
    useState<TransportProfile>("walking");
  const [selectedPlaceToStay, setSelectedPlaceToStay] = useState<string | null>(
    null
  );
  const [selectedPOI, setSelectedPOI] = useState<string | null>(null);
  const [editingPOI, setEditingPOI] = useState<string | null>(null);
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const poiNameRefs = useRef<{ [id: string]: HTMLInputElement }>({});
  const poiNoteRefs = useRef<{ [id: string]: HTMLTextAreaElement }>({});
  const poiUrlRefs = useRef<{ [id: string]: HTMLInputElement }>({});
  const placeNameRefs = useRef<{ [id: string]: HTMLInputElement }>({});
  const placeNoteRefs = useRef<{ [id: string]: HTMLTextAreaElement }>({});
  const placeUrlRefs = useRef<{ [id: string]: HTMLInputElement }>({});
  const [allMarkers, setAllMarkers] = useState<mapboxgl.Marker[]>([]);
  const [currentPopup, setCurrentPopup] = useState<mapboxgl.Popup | null>(null);
  const [mapCenter, setMapCenter] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const [showHelpOverlay, setShowHelpOverlay] = useState(false);

  // Transport profile display names
  const profileDisplayNames: Record<TransportProfile, string> = {
    walking: "Walking",
    "driving-traffic": "Driving",
    cycling: "Cycling",
  };

  // Helper function to ensure URL has protocol
  const ensureHttpsProtocol = (url: string): string => {
    if (!url) return url;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return `https://${url}`;
  };

  // Function to handle adding place from map click
  const addPlaceFromMapClick = async (
    lng: number,
    lat: number,
    placeName: string,
    type: "poi" | "stay"
  ) => {
    const newLocation: Location = {
      coordinates: { lon: lng, lat },
      address: placeName,
      placeName: placeName,
    };

    if (type === "poi") {
      const newPOI: PointOfInterest = {
        id: crypto.randomUUID(),
        name: placeName,
        location: newLocation,
      };
      setPointsOfInterest((prev) => [...prev, newPOI]);
    } else {
      const newPlaceToStay: PlaceToStay = {
        id: crypto.randomUUID(),
        name: placeName,
        location: newLocation,
      };
      setPlacesToStay((prev) => [...prev, newPlaceToStay]);
    }

    // Close the popup
    if (currentPopup) {
      currentPopup.remove();
      setCurrentPopup(null);
    }
  };

  // Function to show add place popup
  const showAddPlacePopup = async (e: mapboxgl.MapMouseEvent) => {
    // Close existing popup
    if (currentPopup) {
      currentPopup.remove();
    }

    const extractPlaceName = (data: any) => {
      if (!data.features || data.features.length === 0) return null;
      return (
        data.features[0].properties?.name ||
        data.features[0].text ||
        data.features[0].place_name ||
        null
      );
    };

    try {
      // Use Tilequery API to get actual map tile data (POI names visible on map)
      let response = await fetch(
        `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${e.lngLat.lng},${e.lngLat.lat}.json?radius=50&limit=5&access_token=${accessToken}`
      );
      let data = await response.json();

      let placeName = null;
      if (data.features && data.features.length > 0) {
        // Look for features with names (POIs, businesses, etc.)
        const namedFeature = data.features.find(
          (feature: any) =>
            feature.properties?.name &&
            feature.properties.name !== "null" &&
            feature.properties.name.trim() !== ""
        );

        if (namedFeature) {
          placeName = namedFeature.properties.name;
        }
      }

      // Fallback to regular geocoding if no named feature found
      if (!placeName) {
        response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${e.lngLat.lng},${e.lngLat.lat}.json?access_token=${accessToken}&types=poi`
        );
        data = await response.json();
        placeName = extractPlaceName(data);
      }

      placeName = placeName || DEFAULT_PLACE_NAME;

      // Create popup with add buttons
      const popup = new mapboxgl.Popup({ offset: 25, closeOnClick: true })
        .setLngLat(e.lngLat)
        .setHTML(
          `
          <div style="padding: 10px; min-width: 200px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px;">${placeName}</h4>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button 
                id="add-poi-btn" 
                style="background: #007cbf; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;"
              >
                Add to Places to Visit
              </button>
              <button 
                id="add-stay-btn" 
                style="background: #28a745; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;"
              >
                Add to Places to Stay
              </button>
            </div>
          </div>
        `
        )
        .addTo(mapInstanceRef.current!);

      setCurrentPopup(popup);

      // Add event listeners to the buttons after popup is added to DOM
      setTimeout(() => {
        const addPOIBtn = document.getElementById("add-poi-btn");
        const addStayBtn = document.getElementById("add-stay-btn");

        if (addPOIBtn) {
          addPOIBtn.addEventListener("click", () => {
            addPlaceFromMapClick(e.lngLat.lng, e.lngLat.lat, placeName, "poi");
          });
        }

        if (addStayBtn) {
          addStayBtn.addEventListener("click", () => {
            addPlaceFromMapClick(e.lngLat.lng, e.lngLat.lat, placeName, "stay");
          });
        }
      }, 50);
    } catch (error) {
      console.error("Error reverse geocoding:", error);
      // Show popup with default name if geocoding fails
      const popup = new mapboxgl.Popup({ offset: 25, closeOnClick: true })
        .setLngLat(e.lngLat)
        .setHTML(
          `
          <div style="padding: 10px; min-width: 200px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px;">${DEFAULT_PLACE_NAME}</h4>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <button 
                id="add-poi-btn" 
                style="background: #007cbf; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;"
              >
                Add to Places to Visit
              </button>
              <button 
                id="add-stay-btn" 
                style="background: #28a745; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;"
              >
                Add to Places to Stay
              </button>
            </div>
          </div>
        `
        )
        .addTo(mapInstanceRef.current!);

      setCurrentPopup(popup);
    }
  };

  const removePOI = (id: string) => {
    if (
      window.confirm("Are you sure you want to remove this place to visit?")
    ) {
      setPointsOfInterest((prev) => prev.filter((poi) => poi.id !== id));
    }
  };

  const updatePOI = useCallback(
    (id: string, updates: Partial<PointOfInterest>) => {
      setPointsOfInterest((prev) =>
        prev.map((poi) => (poi.id === id ? { ...poi, ...updates } : poi))
      );
    },
    []
  );

  const updatePlaceToStay = useCallback(
    (id: string, updates: Partial<PlaceToStay>) => {
      setPlacesToStay((prev) =>
        prev.map((place) =>
          place.id === id ? { ...place, ...updates } : place
        )
      );
    },
    []
  );

  const removePlaceToStay = (id: string) => {
    if (window.confirm("Are you sure you want to remove this place to stay?")) {
      setPlacesToStay((prev) => prev.filter((place) => place.id !== id));
      if (selectedPlaceToStay === id) {
        setSelectedPlaceToStay(null);
      }
    }
  };

  const calculateDistances = async () => {
    if (placesToStay.length === 0 || pointsOfInterest.length === 0) return;

    try {
      const allLocations = [
        ...placesToStay.map((place) => place.location.coordinates),
        ...pointsOfInterest.map((poi) => poi.location.coordinates),
      ];

      const matrixResponse = await fetchMapBoxDirectionsMatrix(
        allLocations,
        transportProfile
      );
      const distances = matrixResponse.distances || [];
      const durations = matrixResponse.durations || [];
      const placesToStayCount = placesToStay.length;

      const updatedPlacesToStay = placesToStay.map((place, placeIndex) => {
        const distancesToPOIs: {
          [poiId: string]: { distance: number; duration: number };
        } = {};
        let totalDistance = 0;
        let totalTime = 0;

        pointsOfInterest.forEach((poi, poiIndex) => {
          const matrixIndex = placesToStayCount + poiIndex;
          const distance =
            (distances[placeIndex][matrixIndex] / 1000) * 0.621371; // Convert to miles
          const duration = durations[placeIndex][matrixIndex] / 60; // Convert to minutes

          distancesToPOIs[poi.id] = { distance, duration };
          totalDistance += distance;
          totalTime += duration;
        });

        return {
          ...place,
          distancesToPOIs,
          averageDistance: totalDistance / pointsOfInterest.length,
          cumulativeDistance: totalDistance,
          averageTime: totalTime / pointsOfInterest.length,
          cumulativeTime: totalTime,
        };
      });

      setPlacesToStay(updatedPlacesToStay);
    } catch (error) {
      console.error("Error calculating distances:", error);
    }
  };

  // URL state management
  const encodeStateToURL = (state: AppState) => {
    try {
      const jsonString = JSON.stringify(state);
      const base64String = btoa(jsonString);
      const url = new URL(window.location.href);
      url.searchParams.set("state", base64String);
      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Error encoding state to URL:", error);
    }
  };

  const decodeStateFromURL = (): AppState | null => {
    try {
      const url = new URL(window.location.href);
      const base64String = url.searchParams.get("state");
      if (!base64String) return null;

      const jsonString = atob(base64String);
      const state = JSON.parse(jsonString) as AppState;
      return state;
    } catch (error) {
      console.error("Error decoding state from URL:", error);
      return null;
    }
  };

  // Load state from URL on mount
  useEffect(() => {
    const urlState = decodeStateFromURL();
    if (urlState) {
      setPointsOfInterest(urlState.pointsOfInterest || []);
      setPlacesToStay(urlState.placesToStay || []);
      setDistanceMode(urlState.distanceMode || "average");
      setTransportProfile(urlState.transportProfile);
      // Map position is handled in useLayoutEffect during map initialization
    }
  }, []);

  // Function to manually save state to URL
  const saveStateToURL = useCallback(() => {
    if (
      pointsOfInterest.length === 0 &&
      placesToStay.length === 0 &&
      !mapCenter
    )
      return;

    const state: AppState = {
      pointsOfInterest,
      placesToStay,
      distanceMode,
      transportProfile,
      mapCenter,
      mapZoom,
    };
    encodeStateToURL(state);
  }, [
    pointsOfInterest,
    placesToStay,
    distanceMode,
    transportProfile,
    mapCenter,
    mapZoom,
  ]);

  // Only save state to URL when NOT editing (to prevent focus loss)
  useEffect(() => {
    if (editingPOI || editingPlace) return;
    saveStateToURL();
  }, [
    pointsOfInterest,
    placesToStay,
    distanceMode,
    transportProfile,
    mapCenter,
    mapZoom,
    editingPOI,
    editingPlace,
    saveStateToURL,
  ]);

  // Recalculate distances when POIs, places to stay, or transport profile change
  useEffect(() => {
    calculateDistances();
  }, [pointsOfInterest.length, placesToStay.length, transportProfile]);

  function AddPointOfInterestControl() {
    return (
      <div>
        <button
          disabled={!searchedLocation}
          onClick={() => {
            if (searchedLocation) {
              const newPOI: PointOfInterest = {
                id: crypto.randomUUID(),
                name:
                  searchedLocation.placeName ||
                  searchedLocation.address ||
                  DEFAULT_PLACE_NAME,
                location: searchedLocation,
              };
              setPointsOfInterest((prevPoints) => [...prevPoints, newPOI]);

              // Distances will be calculated automatically via useEffect
            }
          }}
        >
          Add Point of Interest
        </button>
      </div>
    );
  }

  function AddPlaceToStayControl() {
    return (
      <div>
        <button
          disabled={!searchedLocation}
          onClick={() => {
            if (searchedLocation) {
              const newPlaceToStay: PlaceToStay = {
                id: crypto.randomUUID(),
                name:
                  searchedLocation.placeName ||
                  searchedLocation.address ||
                  DEFAULT_PLACE_NAME,
                location: searchedLocation,
              };
              setPlacesToStay((prevPoints) => [...prevPoints, newPlaceToStay]);

              // Distances will be calculated automatically via useEffect
            }
          }}
        >
          Add Place to Stay
        </button>
      </div>
    );
  }

  function PointsOfInterestDisplay() {
    return (
      <div>
        <ul>
          {pointsOfInterest.map((poi) => (
            <li
              key={poi.id}
              className="place-item"
              style={{
                marginBottom: "10px",
                border:
                  selectedPOI === poi.id
                    ? "2px solid #ffc107"
                    : "1px solid #ddd",
                borderRadius: "5px",
                padding: "8px",
                backgroundColor: selectedPOI === poi.id ? "#fff8dc" : "white",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div
                  onClick={() => {
                    setSelectedPOI(poi.id);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo({
                        center: [
                          poi.location.coordinates.lon,
                          poi.location.coordinates.lat,
                        ],
                        zoom: 14,
                      });
                    }
                  }}
                  style={{ cursor: "pointer", flex: 1 }}
                >
                  <strong>{poi.name}</strong>
                  <br />
                  {poi.location.address}
                  {poi.note && (
                    <div
                      style={{
                        fontSize: "0.9em",
                        color: "#666",
                        marginTop: "5px",
                      }}
                    >
                      📝 {poi.note}
                    </div>
                  )}
                  {poi.url && (
                    <div style={{ fontSize: "0.9em", marginTop: "5px" }}>
                      🔗{" "}
                      <a
                        href={ensureHttpsProtocol(poi.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#007cbf" }}
                      >
                        {poi.url.length > 50
                          ? poi.url.substring(0, 50) + "..."
                          : poi.url}
                      </a>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => {
                      if (editingPOI === poi.id) {
                        setEditingPOI(null);
                      } else {
                        setEditingPOI(poi.id);
                      }
                    }}
                    style={{
                      background: "#007cbf",
                      color: "white",
                      border: "none",
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: "0.8em",
                    }}
                  >
                    {editingPOI === poi.id ? "Cancel" : "Edit"}
                  </button>
                  <button
                    onClick={() => removePOI(poi.id)}
                    style={{
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: "0.8em",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {editingPOI === poi.id && (
                <div
                  className="edit-form"
                  style={{
                    marginTop: "10px",
                    padding: "10px",
                    backgroundColor: "#f8f9fa",
                    borderRadius: "3px",
                  }}
                >
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      Name:
                    </label>
                    <input
                      ref={(el) => {
                        if (el) poiNameRefs.current[poi.id] = el;
                      }}
                      type="text"
                      defaultValue={poi.name || ""}
                      placeholder="Enter a name for this place..."
                      style={{
                        width: "100%",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      Note:
                    </label>
                    <textarea
                      ref={(el) => {
                        if (el) poiNoteRefs.current[poi.id] = el;
                      }}
                      defaultValue={poi.note || ""}
                      placeholder="Add a note about this place..."
                      style={{
                        width: "100%",
                        height: "60px",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      URL:
                    </label>
                    <input
                      ref={(el) => {
                        if (el) poiUrlRefs.current[poi.id] = el;
                      }}
                      type="url"
                      defaultValue={poi.url || ""}
                      placeholder="https://example.com"
                      style={{
                        width: "100%",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div
                    className="edit-buttons"
                    style={{ display: "flex", gap: "10px" }}
                  >
                    <button
                      onClick={() => {
                        const name =
                          poiNameRefs.current[poi.id]?.value || poi.name;
                        const note =
                          poiNoteRefs.current[poi.id]?.value || undefined;
                        const url =
                          poiUrlRefs.current[poi.id]?.value || undefined;
                        updatePOI(poi.id, { name, note, url });
                        setEditingPOI(null);
                      }}
                      style={{
                        background: "#28a745",
                        color: "white",
                        border: "none",
                        padding: "5px 15px",
                        cursor: "pointer",
                        fontSize: "0.9em",
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingPOI(null);
                      }}
                      style={{
                        background: "#6c757d",
                        color: "white",
                        border: "none",
                        padding: "5px 15px",
                        cursor: "pointer",
                        fontSize: "0.9em",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function PlacesToStayDisplay() {
    // Sort places to stay by distance
    const sortedPlacesToStay = [...placesToStay].sort((a, b) => {
      const distanceA =
        distanceMode === "average"
          ? a.averageDistance || 0
          : a.cumulativeDistance || 0;
      const distanceB =
        distanceMode === "average"
          ? b.averageDistance || 0
          : b.cumulativeDistance || 0;
      return distanceA - distanceB;
    });

    return (
      <div>
        <div
          style={{
            marginBottom: "10px",
            display: "flex",
            gap: "15px",
            flexWrap: "wrap",
          }}
        >
          <label>
            Sort by:
            <select
              value={distanceMode}
              onChange={(e) =>
                setDistanceMode(e.target.value as DistanceCalculationMode)
              }
              style={{ marginLeft: "5px" }}
            >
              <option value="average">Average Distance</option>
              <option value="cumulative">Total Distance</option>
            </select>
          </label>
          <label>
            Transport:
            <select
              value={transportProfile}
              onChange={(e) =>
                setTransportProfile(e.target.value as TransportProfile)
              }
              style={{ marginLeft: "5px" }}
            >
              <option value="walking">Walking</option>
              <option value="driving-traffic">Driving</option>
              <option value="cycling">Cycling</option>
            </select>
          </label>
        </div>
        <ul>
          {sortedPlacesToStay.map((place) => (
            <li
              key={place.id}
              className="place-item"
              style={{
                marginBottom: "10px",
                border:
                  selectedPlaceToStay === place.id
                    ? "2px solid #ffc107"
                    : "1px solid #ddd",
                borderRadius: "5px",
                padding: "8px",
                backgroundColor:
                  selectedPlaceToStay === place.id ? "#fff8dc" : "white",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div
                  onClick={() => {
                    setSelectedPlaceToStay(place.id);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo({
                        center: [
                          place.location.coordinates.lon,
                          place.location.coordinates.lat,
                        ],
                        zoom: 14,
                      });
                    }
                  }}
                  style={{ cursor: "pointer", flex: 1 }}
                >
                  <strong>{place.name}</strong>
                  <br />
                  {place.location.address}
                  {place.averageDistance && (
                    <div style={{ fontSize: "0.9em", color: "#666" }}>
                      Avg: {place.averageDistance.toFixed(2)} mi (
                      {place.averageTime?.toFixed(0)} min) | Total:{" "}
                      {place.cumulativeDistance?.toFixed(2)} mi (
                      {place.cumulativeTime?.toFixed(0)} min)
                    </div>
                  )}
                  {place.note && (
                    <div
                      style={{
                        fontSize: "0.9em",
                        color: "#666",
                        marginTop: "5px",
                      }}
                    >
                      📝 {place.note}
                    </div>
                  )}
                  {place.url && (
                    <div style={{ fontSize: "0.9em", marginTop: "5px" }}>
                      🔗{" "}
                      <a
                        href={ensureHttpsProtocol(place.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#007cbf" }}
                      >
                        {place.url.length > 50
                          ? place.url.substring(0, 50) + "..."
                          : place.url}
                      </a>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    onClick={() => {
                      if (editingPlace === place.id) {
                        setEditingPlace(null);
                      } else {
                        setEditingPlace(place.id);
                      }
                    }}
                    style={{
                      background: "#007cbf",
                      color: "white",
                      border: "none",
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: "0.8em",
                    }}
                  >
                    {editingPlace === place.id ? "Cancel" : "Edit"}
                  </button>
                  <button
                    onClick={() => removePlaceToStay(place.id)}
                    style={{
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: "0.8em",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {editingPlace === place.id && (
                <div
                  className="edit-form"
                  style={{
                    marginTop: "10px",
                    padding: "10px",
                    backgroundColor: "#f8f9fa",
                    borderRadius: "3px",
                  }}
                >
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      Name:
                    </label>
                    <input
                      ref={(el) => {
                        if (el) placeNameRefs.current[place.id] = el;
                      }}
                      type="text"
                      defaultValue={place.name || ""}
                      placeholder="Enter a name for this place..."
                      style={{
                        width: "100%",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      Note:
                    </label>
                    <textarea
                      ref={(el) => {
                        if (el) placeNoteRefs.current[place.id] = el;
                      }}
                      defaultValue={place.note || ""}
                      placeholder="Add a note about this place..."
                      style={{
                        width: "100%",
                        height: "60px",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "5px",
                        fontSize: "0.9em",
                        fontWeight: "bold",
                      }}
                    >
                      URL:
                    </label>
                    <input
                      ref={(el) => {
                        if (el) placeUrlRefs.current[place.id] = el;
                      }}
                      type="url"
                      defaultValue={place.url || ""}
                      placeholder="https://example.com"
                      style={{
                        width: "100%",
                        padding: "5px",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    />
                  </div>
                  <div
                    className="edit-buttons"
                    style={{ display: "flex", gap: "10px" }}
                  >
                    <button
                      onClick={() => {
                        const name =
                          placeNameRefs.current[place.id]?.value || place.name;
                        const note =
                          placeNoteRefs.current[place.id]?.value || undefined;
                        const url =
                          placeUrlRefs.current[place.id]?.value || undefined;
                        updatePlaceToStay(place.id, { name, note, url });
                        setEditingPlace(null);
                      }}
                      style={{
                        background: "#28a745",
                        color: "white",
                        border: "none",
                        padding: "5px 15px",
                        cursor: "pointer",
                        fontSize: "0.9em",
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingPlace(null);
                      }}
                      style={{
                        background: "#6c757d",
                        color: "white",
                        border: "none",
                        padding: "5px 15px",
                        cursor: "pointer",
                        fontSize: "0.9em",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  useLayoutEffect(() => {
    mapboxgl.accessToken = accessToken;

    // Check for saved position before initializing map
    const urlState = decodeStateFromURL();
    const initialZoom = urlState?.mapZoom ?? 9;

    mapInstanceRef.current = new mapboxgl.Map({
      container: mapContainerRef.current, // container ID
      center: urlState?.mapCenter
        ? [urlState.mapCenter.lng, urlState.mapCenter.lat]
        : [-106.6504, 35.0844], // starting position [lng, lat] - Downtown Albuquerque, NM
      zoom: initialZoom, // starting zoom
    });

    mapInstanceRef.current.on("load", () => {
      // Map is loaded, resize to ensure proper fit
      mapInstanceRef.current?.resize();

      // Set initial map position in state from current position
      const center = mapInstanceRef.current.getCenter();
      const zoom = mapInstanceRef.current.getZoom();
      setMapCenter({ lng: center.lng, lat: center.lat });
      setMapZoom(zoom);
    });

    // Track map movement
    mapInstanceRef.current.on("moveend", () => {
      const center = mapInstanceRef.current.getCenter();
      const zoom = mapInstanceRef.current.getZoom();
      setMapCenter({ lng: center.lng, lat: center.lat });
      setMapZoom(zoom);
    });

    // Add click handler for adding places
    mapInstanceRef.current.on("click", showAddPlacePopup);

    // Set up ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.resize();
      }
    });

    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (currentPopup) {
        currentPopup.remove();
      }
      mapInstanceRef.current?.remove();
    };
  }, []);

  // Clear all markers
  const clearAllMarkers = () => {
    allMarkers.forEach((marker) => marker.remove());
    setAllMarkers([]);
  };

  // Update map markers when locations change
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing markers
    clearAllMarkers();

    const newMarkers: mapboxgl.Marker[] = [];

    // Add POI markers (blue)
    pointsOfInterest.forEach((poi) => {
      const el = document.createElement("div");
      el.className = "poi-marker";
      el.style.backgroundColor = "#007cbf";
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.cursor = "pointer";
      el.title = poi.name;

      // Highlight selected POI
      if (selectedPOI === poi.id) {
        el.style.backgroundColor = "#ffc107";
        el.style.width = "25px";
        el.style.height = "25px";
      }

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
        `<div style="font-weight: bold; color: #007cbf;">${poi.name}</div>`
      );

      const marker = new mapboxgl.Marker(el)
        .setLngLat([poi.location.coordinates.lon, poi.location.coordinates.lat])
        .setPopup(popup)
        .addTo(mapInstanceRef.current!);

      // Add click listener to select POI
      el.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent map click event from firing
        setSelectedPOI(poi.id);
        mapInstanceRef.current?.flyTo({
          center: [poi.location.coordinates.lon, poi.location.coordinates.lat],
          zoom: 14,
        });
      });

      // Show popup if this POI is selected
      if (selectedPOI === poi.id) {
        marker.togglePopup();
      }

      newMarkers.push(marker);
    });

    // Add place to stay markers (green)
    placesToStay.forEach((place) => {
      const el = document.createElement("div");
      el.className = "place-marker";
      el.style.backgroundColor = "#28a745";
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.cursor = "pointer";
      el.title = place.name;

      // Highlight selected place
      if (selectedPlaceToStay === place.id) {
        el.style.backgroundColor = "#ffc107";
        el.style.width = "25px";
        el.style.height = "25px";
      }

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
        `<div style="font-weight: bold; color: #28a745;">${place.name}</div>`
      );

      const marker = new mapboxgl.Marker(el)
        .setLngLat([
          place.location.coordinates.lon,
          place.location.coordinates.lat,
        ])
        .setPopup(popup)
        .addTo(mapInstanceRef.current!);

      // Add click listener to select place
      el.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent map click event from firing
        setSelectedPlaceToStay(place.id);
        mapInstanceRef.current?.flyTo({
          center: [
            place.location.coordinates.lon,
            place.location.coordinates.lat,
          ],
          zoom: 14,
        });
      });

      // Show popup if this place is selected
      if (selectedPlaceToStay === place.id) {
        marker.togglePopup();
      }

      newMarkers.push(marker);
    });

    // Add search result marker (red) if exists
    if (searchedLocation) {
      const el = document.createElement("div");
      el.className = "search-marker";
      el.style.backgroundColor = "#dc3545";
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.cursor = "pointer";
      el.title = "Search Result";

      // Create popup for search result
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
        `<div style="font-weight: bold; color: #dc3545;">${
          searchedLocation.placeName || "Search Result"
        }</div>`
      );

      const marker = new mapboxgl.Marker(el)
        .setLngLat([
          searchedLocation.coordinates.lon,
          searchedLocation.coordinates.lat,
        ])
        .setPopup(popup)
        .addTo(mapInstanceRef.current!);

      newMarkers.push(marker);
    }

    setAllMarkers(newMarkers);
  }, [
    pointsOfInterest,
    placesToStay,
    searchedLocation,
    selectedPlaceToStay,
    selectedPOI,
  ]);

  return (
    <div className="app-container">

      {/* Help Overlay */}
      {showHelpOverlay && (
        <div className="help-overlay" onClick={() => setShowHelpOverlay(false)}>
          <div className="help-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="help-close"
              onClick={() => setShowHelpOverlay(false)}
            >
              ×
            </button>
            <h2>📍 Loco</h2>
            <p className="help-tagline">Compare places by distance</p>
            <div className="help-description">
              <p>
                <strong>Find the perfect place to stay</strong> by comparing how
                far each option is from all the places you want to visit.
              </p>
              <p>
                <strong>How it works:</strong>
              </p>
              <ul>
                <li>
                  🔍 Search for or click on the map to add places you want to
                  visit
                </li>
                <li>🏨 Add potential places to stay</li>
                <li>📊 See distance calculations automatically updated</li>
                <li>
                  🎯 Pick the accommodation that minimizes your total travel
                </li>
              </ul>
              <p>
                <strong>Tips:</strong> Use different transport modes (walking,
                driving, cycling) to see how your options change!
              </p>
              <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid #ddd" }} />
              <p>
                <strong>Questions or feedback?</strong><br />
                <a 
                  href="mailto:lambdatallc@gmail.com?subject=Loco App Inquiry"
                  style={{ color: "var(--primary-blue)" }}
                >
                  📧 lambdatallc@gmail.com
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Left side - Lists */}
      <div className="sidebar">
        {/* Places to Visit Section */}
        <div
          className="section"
          style={{
            marginBottom: "30px",
            padding: "15px",
            border: "2px solid #007cbf",
            borderRadius: "8px",
            backgroundColor: "#f8fcff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "15px",
            }}
          >
            <h2 style={{ margin: 0, color: "#007cbf" }}>Places to Visit</h2>
            <AddPointOfInterestControl />
          </div>
          <PointsOfInterestDisplay />
        </div>

        {/* Places to Stay Section */}
        <div
          className="section"
          style={{
            marginBottom: "30px",
            padding: "15px",
            border: "2px solid #28a745",
            borderRadius: "8px",
            backgroundColor: "#f8fff8",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "15px",
            }}
          >
            <h2 style={{ margin: 0, color: "#28a745" }}>Places to Stay</h2>
            <AddPlaceToStayControl />
          </div>
          <PlacesToStayDisplay />
        </div>

        {/* Distance Details */}
        {selectedPlaceToStay && (
          <div
            className="distance-details"
            style={{
              padding: "15px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              backgroundColor: "#fff8dc",
            }}
          >
            <h3>Distance Details ({profileDisplayNames[transportProfile]})</h3>
            {(() => {
              const selectedPlace = placesToStay.find(
                (p) => p.id === selectedPlaceToStay
              );
              if (!selectedPlace || !selectedPlace.distancesToPOIs) return null;

              return (
                <div>
                  <h4>Place to Stay: {selectedPlace.name}</h4>
                  <ul>
                    {pointsOfInterest.map((poi) => {
                      const distance = selectedPlace.distancesToPOIs?.[poi.id];
                      if (!distance) return null;
                      return (
                        <li key={poi.id}>
                          <strong>{poi.name}</strong>:{" "}
                          {distance.distance.toFixed(2)} mi (
                          {distance.duration.toFixed(0)} min)
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Right side - Map and Search */}
      <div className="main-content">
        {/* Search Box and Help Button */}
        <div className="search-and-help-container" style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <div className="search-box-wrapper" style={{ flex: "1" }}>
            {/* @ts-ignore */}
            <SearchBox
              accessToken={accessToken}
              map={mapInstanceRef.current}
              mapboxgl={mapboxgl}
              value={searchInputValue}
              placeholder="Search..."
              onChange={(d) => {
                setSearchInputValue(d);
              }}
              onRetrieve={(result) => {
                const coordinates = result.features[0]?.geometry?.coordinates;
                if (coordinates) {
                  setSearchedLocation({
                    address: result.features[0]?.properties?.full_address,
                    coordinates: { lon: coordinates[0], lat: coordinates[1] },
                    placeName:
                      result.features[0]?.properties?.name ||
                      result.features[0]?.properties?.full_address ||
                      DEFAULT_PLACE_NAME,
                  });
                }
              }}
            />
          </div>
          <button
            className="help-button"
            onClick={() => setShowHelpOverlay(true)}
            title="Learn about this app"
          >
            ❓
          </button>
        </div>

        {/* Map */}
        <div
          id="map-container"
          ref={mapContainerRef}
          className="map-container"
          style={{
            height: "600px",
            width: "100%",
            borderRadius: "8px",
            position: "relative",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        />

        {/* Map Legend - Hidden for now */}
        {false && (
          <div
            className="map-legend"
            style={{
              marginTop: "10px",
              padding: "10px",
              backgroundColor: "#f8f9fa",
              borderRadius: "5px",
              width: "100%",
            }}
          >
            <h4 style={{ margin: "0 0 10px 0" }}>Map Legend</h4>
            <div
              className="map-legend-items"
              style={{
                display: "flex",
                gap: "15px",
                fontSize: "0.9em",
                flexWrap: "wrap",
              }}
            >
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: "12px",
                    height: "12px",
                    backgroundColor: "#007cbf",
                    borderRadius: "50%",
                    marginRight: "5px",
                  }}
                ></span>
                Places to Visit
              </span>
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: "12px",
                    height: "12px",
                    backgroundColor: "#28a745",
                    borderRadius: "50%",
                    marginRight: "5px",
                  }}
                ></span>
                Places to Stay
              </span>
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: "12px",
                    height: "12px",
                    backgroundColor: "#ffc107",
                    borderRadius: "50%",
                    marginRight: "5px",
                  }}
                ></span>
                Selected Place
              </span>
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: "12px",
                    height: "12px",
                    backgroundColor: "#dc3545",
                    borderRadius: "50%",
                    marginRight: "5px",
                  }}
                ></span>
                Search Result
              </span>
            </div>
          </div>
        )}
      </div>


    </div>
  );
}

export default App;
