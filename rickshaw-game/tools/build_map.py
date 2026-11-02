"""Turn an OpenStreetMap download (Overpass JSON, "out geom") around Mirpur-10 Circle
into the compact local map the game loads.

    python3 build_map.py raw.json ../mirpur.json

Coordinates become metres around Mirpur-10 Circle (x east, z south), stored as
whole decimetres. Building heights are estimated where OSM has no floor count.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, re, sys, random, collections

LAT0, LON0 = 23.80709, 90.36861          # centre of Mirpur-10 Circle
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0

def xz(p):
    return ((p['lon'] - LON0) * KX, -(p['lat'] - LAT0) * KZ)

def simplify(pts, eps):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    (ax, az), (bx, bz) = pts[0], pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        d = abs((px - ax) * dz - (pz - az) * dx) / L
        if d > best:
            best, idx = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], eps)[:-1] + simplify(pts[idx:], eps)

def simplify_keep(pts, keep, eps):
    """Simplify a road but never drop a junction (a node another road shares)."""
    cuts = [0] + [i for i in range(1, len(pts) - 1) if keep[i]] + [len(pts) - 1]
    out = []
    for a, b in zip(cuts, cuts[1:]):
        out += simplify(pts[a:b + 1], eps)[:-1]
    return out + [pts[-1]]

def area(poly):
    return 0.5 * sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(len(poly)))

def flat(pts):
    out = []
    for x, z in pts:
        out += [round(x * 10), round(z * 10)]
    return out

ROAD = {  # class, default lanes, metres per lane
    'primary': ('p', 3, 3.3), 'primary_link': ('p', 1, 3.6), 'trunk': ('p', 3, 3.3),
    'secondary': ('t', 2, 3.3), 'tertiary': ('t', 2, 3.2), 'tertiary_link': ('t', 1, 3.6),
    'residential': ('r', 0, 0), 'unclassified': ('r', 0, 0), 'living_street': ('g', 0, 0),
    'service': ('s', 0, 0), 'footway': ('f', 0, 0), 'path': ('f', 0, 0), 'steps': ('f', 0, 0), 'pedestrian': ('f', 0, 0),
}
FIXED_W = {'r': 6.0, 'g': 4.5, 's': 4.0, 'f': 2.6}
# named places worth a big sign and a trip: [category, what the game calls it]
LANDMARK = {'fire_station': 'fire', 'training': 'school', 'police': 'police', 'hospital': 'hospital', 'clinic': 'hospital',
            'bus_station': 'bus', 'marketplace': 'market', 'school': 'school', 'college': 'school', 'university': 'school',
            'fuel': 'fuel', 'place_of_worship': 'mosque', 'government': 'office', 'post_office': 'office', 'townhall': 'office'}
GREEN = {'stadium', 'pitch', 'park', 'playground', 'meadow', 'grass', 'cemetery', 'recreation_ground', 'garden'}

def main(src, dst):
    els = json.load(open(src))['elements']
    roads, buildings, rail, station, green, water, pois, landmarks = [], [], [], [], [], [], [], []
    uses = collections.Counter(n for e in els if e['type'] == 'way' and e.get('tags', {}).get('highway') in ROAD for n in set(e.get('nodes', [])))
    for e in els:
        t = e.get('tags', {})
        if e['type'] == 'way' and 'highway' in t and t['highway'] in ROAD and 'geometry' in e:
            cls, lanes, per = ROAD[t['highway']]
            pts = simplify_keep([xz(p) for p in e['geometry']], [uses[n] > 1 for n in e['nodes']], 0.5)
            ow = 1 if t.get('oneway') in ('yes', '1') or t.get('junction') == 'roundabout' else -1 if t.get('oneway') == '-1' else 0
            if cls in FIXED_W:
                w = FIXED_W[cls]
            else:
                try:
                    n = int(t.get('lanes', 0)) or lanes
                except ValueError:
                    n = lanes
                w = n * per + 0.8 if ow else max(8.0, n * per + 1.0) if t.get('lanes') else (14.0 if cls == 'p' else 8.5)
            name = t.get('name:en') or t.get('name') or ''
            roads.append([cls, round(w * 10), ow, name] + flat(pts))
        elif e['type'] == 'way' and t.get('railway') == 'subway' and 'geometry' in e:
            rail.append(flat(simplify([xz(p) for p in e['geometry']], 0.5)))
        elif e['type'] == 'way' and t.get('railway') in ('station', 'platform') and 'geometry' in e:
            station.append(flat([xz(p) for p in e['geometry']][:-1]))
        elif e['type'] == 'way' and 'building' in t and 'geometry' in e:
            pts = [xz(p) for p in e['geometry']]
            if len(pts) > 3 and pts[0] == pts[-1]:
                pts = pts[:-1]
            # a closed ring: split at the corner farthest from the first, simplify each half
            k = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
            pts = simplify(pts[:k + 1], 0.35)[:-1] + simplify(pts[k:] + [pts[0]], 0.35)[:-1]
            if len(pts) < 3:
                continue
            a = area(pts)
            if abs(a) < 6:
                continue
            if a < 0:
                pts.reverse()
            buildings.append({'id': e['id'], 'pts': pts, 'area': abs(a), 'tags': t})
        elif e['type'] == 'way' and 'geometry' in e and (t.get('leisure') in GREEN or t.get('landuse') in GREEN):
            pts = [xz(p) for p in e['geometry']]
            if pts[0] == pts[-1]:
                green.append([t.get('leisure') or t.get('landuse')] + flat(pts[:-1]))
        elif e['type'] == 'way' and 'geometry' in e and (t.get('natural') == 'water' or 'water' in t or t.get('leisure') == 'swimming_pool'):
            pts = [xz(p) for p in e['geometry']]
            if pts[0] == pts[-1]:
                water.append(flat(pts[:-1]))
        kind = LANDMARK.get(t.get('amenity')) or LANDMARK.get(t.get('office')) or ('market' if t.get('building') in ('commercial', 'retail') and t.get('name') else None)
        if t.get('name') and kind and (e['type'] == 'node' or 'geometry' in e):
            if e['type'] == 'node':
                x, z = xz(e)
            else:
                g = [xz(p) for p in e['geometry']]
                x, z = sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)
            name = (t.get('name:en') or t['name']).split(',')[0].strip()[:44]
            if kind == 'school' and t.get('amenity') == 'training' and re.search(r'\bfire\b', name, re.I):  # the fire service HQ is mapped as a training site
                kind = 'fire'
            landmarks.append([round(x * 10), round(z * 10), name, kind])
            continue
        if e['type'] == 'node' and t.get('name') and (t.get('shop') or t.get('amenity')):
            x, z = xz(e)
            pois.append([round(x * 10), round(z * 10), t['name'][:40], (t.get('name:en') or '')[:40], t.get('shop') or t.get('amenity')])

    # how close each building sits to a main road decides its estimated height
    segs = collections.defaultdict(list)
    for r in roads:
        if r[0] not in ('p', 't'):
            continue
        c = r[4:]
        for i in range(0, len(c) - 2, 2):
            ax, az, bx, bz = c[i] / 10, c[i + 1] / 10, c[i + 2] / 10, c[i + 3] / 10
            for gx in range(int(min(ax, bx) // 40) - 1, int(max(ax, bx) // 40) + 2):
                for gz in range(int(min(az, bz) // 40) - 1, int(max(az, bz) // 40) + 2):
                    segs[(gx, gz)].append((ax, az, bx, bz, r[0]))

    def near_main(x, z):
        best = {'p': 1e9, 't': 1e9}
        for s in segs.get((int(x // 40), int(z // 40)), []):
            ax, az, bx, bz, c = s
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz or 1e-9
            u = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
            best[c] = min(best[c], math.hypot(ax + u * dx - x, az + u * dz - z))
        return best

    out_b = []
    for b in buildings:
        t, rnd = b['tags'], random.Random(b['id'])
        cx = sum(p[0] for p in b['pts']) / len(b['pts'])
        cz = sum(p[1] for p in b['pts']) / len(b['pts'])
        kind = 2 if t.get('building') == 'mosque' or t.get('amenity') == 'place_of_worship' else 1 if t.get('building') in ('roof', 'shed', 'hut', 'kiosk', 'garage', 'garages') else 0
        lv = None
        for key in ('building:levels',):
            try:
                lv = max(1, min(30, int(float(t[key]))))
            except (KeyError, ValueError):
                pass
        if lv is None and 'height' in t:
            try:
                lv = max(1, round(float(t['height'].split()[0]) / 3.2))
            except ValueError:
                pass
        if lv is None:
            d = near_main(cx, cz)
            if kind == 1 or b['area'] < 25:
                lv = 1
            elif b['area'] < 60:
                lv = rnd.randint(1, 3)
            elif d['p'] < 32:
                lv = rnd.randint(5, 10)
            elif d['t'] < 22 or d['p'] < 60:
                lv = rnd.randint(4, 7)
            else:
                lv = rnd.choice([3, 4, 4, 5, 5, 6, 6, 6])
        out_b.append([lv, kind] + flat(b['pts']))

    allx = [v for b in out_b for v in b[2::2]]
    allz = [v for b in out_b for v in b[3::2]]
    data = {
        'note': 'Map data (c) OpenStreetMap contributors, ODbL. Units: decimetres around Mirpur-10 Circle.',
        'origin': [LAT0, LON0], 'bounds': [min(allx), min(allz), max(allx), max(allz)],
        'b': out_b, 'r': roads, 'rail': rail, 'station': station, 'green': green, 'water': water, 'poi': pois, 'lm': landmarks,
    }
    json.dump(data, open(dst, 'w'), separators=(',', ':'), ensure_ascii=False)
    print(f'{len(out_b)} buildings, {len(roads)} roads, {len(rail)} rail, {len(station)} station, {len(green)} green, {len(water)} water, {len(pois)} pois, {len(landmarks)} landmarks')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
