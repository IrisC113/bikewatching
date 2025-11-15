import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);
console.log('D3 Loaded:', d3.version);

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiaXJpc2NoZW4xMTMiLCJhIjoiY21od3VhanBrMDNoOTJpcHRwb2I5dndvNCJ9.wBLYuVRwbVzmfd5CJnFBww';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', 
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
  const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

  return stations.map(station => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 }
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 }
  });

  let stations = [];
  let trips = [];
  let originalStations = [];

  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    const rawStations = jsonData.data.stations;
    originalStations = rawStations;
    console.log('Stations Array:', rawStations);

    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      trip => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );

    stations = computeStationTraffic(rawStations, trips);
    console.log("Stations with traffic data:", stations);
    console.log('Loaded Trips Data:', trips);
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  const svg = d3.select('#map')
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .style('position', 'absolute')
    .style('top', 0)
    .style('left', 0)
    .style('pointer-events', 'none');

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  let circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('--departure-ratio', d => 
    stationFlow(d.departures / d.totalTraffic)
  );

  circles.each(function(d) {
    d3.select(this).append('title')
      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
  });

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('time-display');
  const anyTimeLabel = document.getElementById('any-time');

  let timeFilter = -1;

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      anyTimeLabel.style.display = 'block';
      selectedTime.style.display = 'none';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
      selectedTime.style.display = 'block';
    }
    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(originalStations, filteredTrips);

    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles = svg.selectAll('circle')
      .data(filteredStations, d => d.short_name)
      .style('--departure-ratio', d =>
      stationFlow(d.departures / d.totalTraffic)
    );

    circles.join(
      enter => enter.append('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .each(d => d3.select(this).append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`)),
      update => update
        .attr('r', d => radiusScale(d.totalTraffic))
        .select('title')
        .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`),
      exit => exit.remove()
    );

    updatePositions();
  }

  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter(trip => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return Math.abs(startedMinutes - timeFilter) <= 60 || Math.abs(endedMinutes - timeFilter) <= 60;
      });
}
