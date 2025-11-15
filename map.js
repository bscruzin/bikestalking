// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Precomputed minute buckets (1440 minutes in a day)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Map a continuous ratio → 3 discrete values
const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken =
  'pk.eyJ1IjoiYnNjcnV6aW4iLCJhIjoiY21oemVmeWFoMGxydjJtcTB1YXo4bndjbSJ9.bQjfr-f3r--Gql1pgNJgvw';


let timeFilter = -1; // global filter state

function formatTime(minutes) {
  if (minutes < 0) return '(any time)';
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
      return tripsByMinute.flat();
    }
  
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
  
    if (minMinute > maxMinute) {
      let beforeMidnight = tripsByMinute.slice(minMinute);
      let afterMidnight = tripsByMinute.slice(0, maxMinute);
      return beforeMidnight.concat(afterMidnight).flat();
    } else {
      return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
  }  

  function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
      filterByMinute(departuresByMinute, timeFilter),
      v => v.length,
      d => d.start_station_id
    );
  
    const arrivals = d3.rollup(
      filterByMinute(arrivalsByMinute, timeFilter),
      v => v.length,
      d => d.end_station_id
    );
  
    return stations.map(station => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
  }  

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.094146, 42.360094],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl(), 'top-left');

const INPUT_BLUEBIKES_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const INPUT_TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';


map.on('load', async () => {
  const bikeLaneStyle = {
    'line-color': '#32D400',
    'line-width': 5,
    'line-opacity': 0.6,
  };

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'data/Existing_Bike_Network_2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'data/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });


  let stations = [];
  try {
    const jsonData = await d3.json(INPUT_BLUEBIKES_URL);
    stations = jsonData.data.stations;
    console.log('Stations:', stations);
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  let trips = await d3.csv(INPUT_TRIPS_URL, trip => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
  
    const startMin = minutesSinceMidnight(trip.started_at);
    const endMin = minutesSinceMidnight(trip.ended_at);
  
    departuresByMinute[startMin].push(trip);
    arrivalsByMinute[endMin].push(trip);
  
    return trip;
  });  

  console.log('Loaded trips:', trips.length);

  // Compute initial traffic
  stations = computeStationTraffic(stations, -1);

  // Radius scale (updated dynamically later)
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const svg = d3.select('#map').select('svg');

  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) => {
        if (d.totalTraffic === 0) return 0.5;  // balanced default
        return stationFlow(d.departures / d.totalTraffic);
      })        
    .attr('fill-opacity', 0.6)
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('pointer-events', 'auto')
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  // Update circle positions on map move/zoom
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);


  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');  


  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);
  
    // Adjust scale range depending on filtering
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);
  
    circles
      .data(filteredStations, d => d.short_name)
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => {
        if (d.totalTraffic === 0) return 0.5;  // balanced default
        return stationFlow(d.departures / d.totalTraffic);
      })      
      .select('title')
      .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    
  }  

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
