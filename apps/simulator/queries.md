Road Network
```
[out:json][timeout:300];
{{geocodeArea:Nairobi}}->.searchArea;

// Fetch POIs
(
  node["shop"](area.searchArea);
  node["leisure"](area.searchArea);
  node["craft"](area.searchArea);
  node["office"](area.searchArea);
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]
    ["highway"!="service"]
    ["highway"!="footway"]
    ["highway"!="cycleway"]
    ["highway"!="path"]
    ["highway"!="track"]
    (area.searchArea);
);

// Output POIs
out body;
>;

// Output highways
out geom;
```

Point Of Interest
```
[out:json][timeout:300];
{{geocodeArea:Nairobi}}->.searchArea;

(
  node["shop"](area.searchArea);
  node["tourism"](area.searchArea);
  node["leisure"](area.searchArea);
  node["craft"](area.searchArea);
  node["office"](area.searchArea);
);

out center;
>;
out skel qt;
```