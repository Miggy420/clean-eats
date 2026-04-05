const API_BASE = "https://data.kingcounty.gov/resource/f29f-zza5.json";
const GRADE_LABELS = {
    "1": "Excellent",
    "2": "Good",
    "3": "Okay",
    "4": "Needs Improvement"
};
const GRADE_COLORS = {
    "1": "#4ecca3",
    "2": "#59a5d8",
    "3": "#f0c929",
    "4": "#e74c3c"
};

let map;
let markers = [];
let infoWindow;
let allRestaurants = [];

function initMap() {
    const WA_BOUNDS = {
        north: 49.0,
        south: 45.5,
        west: -125.0,
        east: -116.9
    };

    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 47.6062, lng: -122.3321 },
        zoom: 11,
        restriction: {
            latLngBounds: WA_BOUNDS,
            strictBounds: true
        },
        minZoom: 7,
        gestureHandling: "greedy",
        zoomControl: true,
        scrollwheel: true,
        isFractionalZoomEnabled: true,
        keyboardShortcuts: false,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#212121" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
            { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }
        ]
    });

    infoWindow = new google.maps.InfoWindow();

    document.getElementById("search-btn").addEventListener("click", doSearch);
    document.getElementById("search").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSearch();
    });

    // Clean Eats Only toggle
    document.getElementById("clean-only").addEventListener("change", (e) => {
        if (e.target.checked) {
            document.getElementById("grade-filter").value = "1";
            document.getElementById("grade-filter").disabled = true;
        } else {
            document.getElementById("grade-filter").value = "";
            document.getElementById("grade-filter").disabled = false;
        }
        if (allRestaurants.length > 0) {
            doSearch();
        }
    });

    // Detail panel close
    document.getElementById("detail-close").addEventListener("click", closeDetailPanel);

    loadCities();
}

async function loadCities() {
    const url = `${API_BASE}?$select=city,count(city)&$group=city&$order=city&$limit=200`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const select = document.getElementById("city-filter");
        data.forEach(row => {
            if (row.city) {
                const opt = document.createElement("option");
                opt.value = row.city;
                opt.textContent = titleCase(row.city);
                select.appendChild(opt);
            }
        });
    } catch (err) {
        console.error("Failed to load cities:", err);
    }
}

async function doSearch() {
    const name = document.getElementById("search").value.trim();
    const city = document.getElementById("city-filter").value;
    const cleanOnly = document.getElementById("clean-only").checked;
    const grade = cleanOnly ? "1" : document.getElementById("grade-filter").value;

    const conditions = [];
    if (name) conditions.push(`upper(name) like '%${name.toUpperCase().replace(/'/g, "''")}%'`);
    if (city) conditions.push(`city='${city}'`);
    if (grade) conditions.push(`grade='${grade}'`);

    if (conditions.length === 0) {
        conditions.push("city='SEATTLE'");
    }

    const where = conditions.join(" AND ");
    const url = `${API_BASE}?$select=name,address,city,zip_code,latitude,longitude,grade,inspection_score,inspection_date,inspection_result,business_id&$where=${encodeURIComponent(where)}&$order=inspection_date DESC&$limit=5000`;

    const results = document.getElementById("results");
    results.innerHTML = '<p class="loading">Loading...</p>';

    try {
        const res = await fetch(url);
        const data = await res.json();

        // Group by business_id to get latest inspection per restaurant
        const businesses = {};
        data.forEach(row => {
            const id = row.business_id || row.name + row.address;
            if (!businesses[id] || row.inspection_date > businesses[id].inspection_date) {
                businesses[id] = row;
            }
        });

        allRestaurants = Object.values(businesses)
            .filter(r => r.latitude && r.longitude)
            .sort((a, b) => (a.grade || "9").localeCompare(b.grade || "9"));

        displayResults(allRestaurants);
        displayMarkers(allRestaurants);
    } catch (err) {
        results.innerHTML = '<p class="placeholder">Error loading data. Try again.</p>';
        console.error(err);
    }
}

function displayResults(restaurants) {
    const results = document.getElementById("results");

    if (restaurants.length === 0) {
        results.innerHTML = '<p class="placeholder">No restaurants found</p>';
        return;
    }

    let html = `<p class="result-count">${restaurants.length} restaurants found</p>`;

    restaurants.forEach((r, i) => {
        const grade = r.grade || "?";
        const label = GRADE_LABELS[grade] || "Unrated";
        const date = r.inspection_date ? new Date(r.inspection_date).toLocaleDateString() : "N/A";

        html += `
            <div class="result-card grade-${grade}" onclick="focusMarker(${i})">
                <div class="result-name">${escapeHtml(r.name)}</div>
                <div class="result-address">${escapeHtml(r.address || "")}, ${titleCase(r.city || "")}</div>
                <div class="result-grade">${label}</div>
                <div class="result-score">Score: ${r.inspection_score || "N/A"} | Last inspected: ${date}</div>
                <button class="result-history-btn" onclick="event.stopPropagation(); showHistory('${escapeAttr(r.business_id)}', '${escapeAttr(r.name)}', '${escapeAttr(r.address)}', '${escapeAttr(r.city)}')">View Inspection History</button>
            </div>
        `;
    });

    results.innerHTML = html;
}

function displayMarkers(restaurants) {
    markers.forEach(m => m.setMap(null));
    markers = [];

    const bounds = new google.maps.LatLngBounds();

    restaurants.forEach(r => {
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        const grade = r.grade || "?";
        const color = GRADE_COLORS[grade] || "#888";

        const marker = new google.maps.Marker({
            position: { lat, lng },
            map: map,
            title: r.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: color,
                fillOpacity: 0.9,
                strokeColor: "#fff",
                strokeWeight: 1.5,
                scale: 8
            }
        });

        const label = GRADE_LABELS[grade] || "Unrated";
        const date = r.inspection_date ? new Date(r.inspection_date).toLocaleDateString() : "N/A";
        const bid = escapeAttr(r.business_id);
        const bname = escapeAttr(r.name);
        const baddr = escapeAttr(r.address);
        const bcity = escapeAttr(r.city);

        marker.addListener("click", () => {
            infoWindow.setContent(`
                <div class="info-window">
                    <h3>${escapeHtml(r.name)}</h3>
                    <p>${escapeHtml(r.address || "")}, ${titleCase(r.city || "")}</p>
                    <p class="iw-grade" style="color:${color}">${label}</p>
                    <p>Score: ${r.inspection_score || "N/A"}</p>
                    <p>Last inspected: ${date}</p>
                    <p>Result: ${r.inspection_result || "N/A"}</p>
                    <button class="iw-history-btn" onclick="showHistory('${bid}', '${bname}', '${baddr}', '${bcity}')">View Full History</button>
                </div>
            `);
            infoWindow.open(map, marker);
        });

        markers.push(marker);
        bounds.extend(marker.getPosition());
    });

    if (markers.length > 0) {
        // Calculate the center of all markers, weighted toward the cluster
        const lats = markers.map(m => m.getPosition().lat());
        const lngs = markers.map(m => m.getPosition().lng());

        // Use median to ignore outliers
        lats.sort((a, b) => a - b);
        lngs.sort((a, b) => a - b);
        const midIdx = Math.floor(lats.length / 2);
        const medianLat = lats[midIdx];
        const medianLng = lngs[midIdx];

        // Build bounds from the middle 90% of markers to ignore outliers
        const trim = Math.floor(markers.length * 0.05);
        const coreLats = lats.slice(trim, lats.length - trim);
        const coreLngs = lngs.slice(trim, lngs.length - trim);

        const coreBounds = new google.maps.LatLngBounds(
            { lat: coreLats[0], lng: coreLngs[0] },
            { lat: coreLats[coreLats.length - 1], lng: coreLngs[coreLngs.length - 1] }
        );

        map.fitBounds(coreBounds, { left: 400, top: 50, right: 50, bottom: 50 });

        google.maps.event.addListenerOnce(map, "idle", () => {
            if (map.getZoom() > 16) map.setZoom(16);
        });
    } else {
        map.setCenter({ lat: 47.6062, lng: -122.3321 });
        map.setZoom(11);
    }
}

async function showHistory(businessId, name, address, city) {
    const panel = document.getElementById("detail-panel");
    const content = document.getElementById("detail-content");

    panel.classList.remove("hidden");
    content.innerHTML = '<p class="loading">Loading inspection history...</p>';

    const url = `${API_BASE}?$where=business_id='${businessId}'&$order=inspection_date DESC&$limit=1000`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        // Group by inspection_serial_num
        const inspections = {};
        data.forEach(row => {
            const id = row.inspection_serial_num;
            if (!inspections[id]) {
                inspections[id] = {
                    date: row.inspection_date,
                    type: row.inspection_type,
                    score: row.inspection_score,
                    result: row.inspection_result,
                    grade: row.grade,
                    closed: row.inspection_closed_business,
                    violations: []
                };
            }
            if (row.violation_description) {
                inspections[id].violations.push({
                    type: row.violation_type,
                    description: row.violation_description,
                    points: row.violation_points
                });
            }
        });

        const sorted = Object.values(inspections).sort((a, b) =>
            (b.date || "").localeCompare(a.date || "")
        );

        let html = `
            <h2>${escapeHtml(decodeAttr(name))}</h2>
            <p class="detail-address">${escapeHtml(decodeAttr(address))}, ${titleCase(decodeAttr(city))}</p>
        `;

        if (sorted.length > 0) {
            const latest = sorted[0];
            const latestGrade = latest.grade || "?";
            const latestColor = GRADE_COLORS[latestGrade] || "#888";
            html += `
                <div class="detail-current">
                    <h3>Current Rating</h3>
                    <p style="font-size: 22px; font-weight: bold; color: ${latestColor}">
                        ${GRADE_LABELS[latestGrade] || "Unrated"}
                    </p>
                    <p style="color: #aaa; font-size: 13px;">Score: ${latest.score || "N/A"} | ${latest.result || "N/A"}</p>
                </div>
            `;
        }

        html += `<div class="history-section"><h3>Inspection History (${sorted.length} inspections)</h3>`;

        sorted.forEach(insp => {
            const date = insp.date ? new Date(insp.date).toLocaleDateString() : "Unknown date";
            const resultClass = (insp.result || "").toLowerCase().replace(/\s+/g, "-");

            html += `
                <div class="inspection-item result-${resultClass}">
                    <div class="inspection-date">${date}</div>
                    <div class="inspection-meta">
                        <span>${insp.type || "Inspection"}</span>
                        <span>Score: ${insp.score || "N/A"}</span>
                        <span>${insp.result || ""}</span>
                        ${insp.closed === "true" ? '<span style="color: #e74c3c; font-weight: bold;">CLOSED</span>' : ""}
                    </div>
            `;

            if (insp.violations.length > 0) {
                html += '<div class="violations-list">';
                insp.violations.forEach(v => {
                    const typeClass = (v.type || "").toLowerCase().includes("red") ? "red" : "blue";
                    html += `
                        <div class="violation">
                            <span class="violation-type ${typeClass}">${v.type || ""} (${v.points || 0}pts)</span>
                            <span class="violation-desc">${escapeHtml(v.description)}</span>
                        </div>
                    `;
                });
                html += '</div>';
            } else {
                html += '<p class="no-violations">No violations recorded</p>';
            }

            html += '</div>';
        });

        html += '</div>';
        content.innerHTML = html;
    } catch (err) {
        content.innerHTML = '<p class="placeholder">Error loading history.</p>';
        console.error(err);
    }
}

function closeDetailPanel() {
    document.getElementById("detail-panel").classList.add("hidden");
}

function focusMarker(index) {
    if (markers[index]) {
        map.setCenter(markers[index].getPosition());
        map.setZoom(16);
        google.maps.event.trigger(markers[index], "click");
    }
}

function titleCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return encodeURIComponent(str || "");
}

function decodeAttr(str) {
    return decodeURIComponent(str || "");
}
