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
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$"]
    ["highway"!="service"]
    ["highway"!="footway"]
    ["highway"!="cycleway"]
    ["highway"!="path"]
    ["highway"!="track"]
    ["access"!="private"]
    ["access"!="no"]
    (area.searchArea);
  way["junction"="roundabout"](area.searchArea);
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