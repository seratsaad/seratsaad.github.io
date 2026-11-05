"""Real colours for the building fronts on the main roads around Mirpur-10 Circle, read from Mapillary photos.

    python3 build_facades.py ../mirpur.json WORKDIR ../facades/fronts_auto.json

Needs a Mapillary client token: the 32-character code in ~/.mapillary_token (the MLY|app| prefix is added here).
For each building wall that faces a main road, the best few dashcam photos are projected onto the wall,
aligned to each other, and blended with a per-pixel median so buses and people mostly drop out.
No photo pixels are kept for the game: only the wall, sign and shop colours go into fronts_auto.json,
and draw_fronts.py draws clean fronts from them. Straightened reference images go to WORKDIR/refs
(for drawing the landmarks by hand); they are not published.
Colours read from street images (c) Mapillary contributors, CC BY-SA 4.0.
"""
import io, json, math, os, sys, time, urllib.parse, urllib.request
import cv2
import numpy as np
from PIL import Image

LAT0, LON0 = 23.80709, 90.36861
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
APP = '28837783689183059'
CAM_H = 1.6          # dashcam height above the road, metres
PX_PER_M = 20        # low res on purpose
FLOOR = 3.2
MAX_FLOORS = 3       # photos from the street rarely see above the third floor
RADIUS = 260         # metres around the circle

MAP_PATH, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK + '/img', exist_ok=True)
os.makedirs(WORK + '/refs', exist_ok=True)
TOKEN = 'MLY|' + APP + '|' + open(os.path.expanduser('~/.mapillary_token')).read().strip()
M = json.load(open(MAP_PATH))
dm = lambda a: [(a[i] / 10, a[i + 1] / 10) for i in range(0, len(a), 2)]
local = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KZ)


def api(params):
    req = urllib.request.Request('https://graph.mapillary.com/images?' + urllib.parse.urlencode(params), headers={'Authorization': 'OAuth ' + TOKEN})
    for attempt in range(5):
        try:
            return json.load(urllib.request.urlopen(req, timeout=90))['data']
        except Exception:
            time.sleep(2 + 2 * attempt)
    return None


# ---------- photo metadata, cached ----------
meta_path = WORK + '/meta.json'
if not os.path.exists(meta_path):
    fields = 'id,captured_at,computed_geometry,computed_altitude,computed_compass_angle,camera_parameters,camera_type,width,height,is_pano,thumb_2048_url'
    found, step = {}, 0.001
    for i in range(-3, 3):
        for j in range(-3, 3):
            lon0, lat0 = LON0 + i * step, LAT0 + j * step
            data = api({'fields': fields, 'bbox': f'{lon0},{lat0},{lon0 + step},{lat0 + step}', 'limit': 1000})
            for d in data or []:
                found[d['id']] = d
    json.dump(list(found.values()), open(meta_path, 'w'))
meta = json.load(open(meta_path))

# ---------- the metro line: photos taken from the train are useless at street level ----------
rails = [dm(c) for c in M.get('rail', [])]


def seg_dist(x, z, pts):
    best = 1e9
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz or 1e-9
        u = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
        best = min(best, math.hypot(ax + u * dx - x, az + u * dz - z))
    return best


cams = []
for d in meta:
    if d.get('is_pano') or d.get('camera_type') != 'perspective' or not d.get('camera_parameters') or not d.get('computed_geometry'):
        continue
    x, z = local(*d['computed_geometry']['coordinates'])
    if math.hypot(x, z) > RADIUS + 70:
        continue
    f, k1, k2 = (d['camera_parameters'] + [0, 0, 0])[:3]
    cams.append({'id': d['id'], 'x': x, 'z': z, 'alt': d.get('computed_altitude'), 'h': math.radians(d['computed_compass_angle']),
                 'f': f, 'k1': k1, 'k2': k2, 'W': d['width'], 'H': d['height'],
                 'year': time.gmtime(d['captured_at'] / 1000).tm_year, 'url': d['thumb_2048_url']})
# a photo much higher than its neighbours, or right on the viaduct line, was taken from the train
for c in cams:
    near = [o['alt'] for o in cams if o['alt'] is not None and abs(o['x'] - c['x']) < 40 and abs(o['z'] - c['z']) < 40]
    med = float(np.median(near)) if near else None
    high = c['alt'] is not None and med is not None and c['alt'] - med > 5
    on_rail = any(seg_dist(c['x'], c['z'], r) < 3.5 for r in rails)
    c['train'] = high or on_rail
cams = [c for c in cams if not c['train']]
print(len(cams), 'street-level photos', file=sys.stderr)

# ---------- walls that face a main road ----------
roads = [(r[1] / 10, dm(r[4:])) for r in M['r'] if r[0] == 'p']
road_dist = lambda x, z: min(seg_dist(x, z, pts) - w / 2 for w, pts in roads)
walls = []
for bi, b in enumerate(M['b']):
    lv, pts = b[0], dm(b[2:])
    cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    if math.hypot(cx, cz) > RADIUS or lv < 2:
        continue
    A = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if A > 0:
        pts = pts[::-1]  # clockwise, as in the game, so edge numbers match and (-dz, dx) points outward
    for i in range(len(pts)):
        (ax, az), (bx, bz) = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(bx - ax, bz - az)
        if L < 5:
            continue
        nx, nz = -(bz - az) / L, (bx - ax) / L
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        if any(road_dist(mx + nx * s, mz + nz * s) < 0 for s in (4, 8, 12, 16)):
            walls.append({'b': bi, 'e': i, 'a': (ax, az), 'c': (bx, bz), 'L': L, 'n': (nx, nz), 'm': (mx, mz), 'h': min(lv, MAX_FLOORS) * FLOOR})
print(len(walls), 'road-facing walls', file=sys.stderr)


def view_score(w, c):
    vx, vz = w['m'][0] - c['x'], w['m'][1] - c['z']
    d = math.hypot(vx, vz)
    if d < 7 or d > 38:
        return 0
    fx, fz = math.sin(c['h']), -math.cos(c['h'])
    hfov = math.atan(c['W'] / 2 / (c['f'] * max(c['W'], c['H'])))
    if math.acos(max(-1, min(1, (vx * fx + vz * fz) / d))) > hfov * 0.8:
        return 0
    facing = -(vx * w['n'][0] + vz * w['n'][1]) / d
    if facing < 0.35:
        return 0
    return facing * (1 - d / 45) * (1 + 0.15 * max(0, c['year'] - 2018))


def project(c, X, Y, Z):
    fx, fz = math.sin(c['h']), -math.cos(c['h'])
    rx, rz = math.cos(c['h']), math.sin(c['h'])
    dx, dy, dz = X - c['x'], Y - CAM_H, Z - c['z']
    xc, yc, zc = dx * rx + dz * rz, dy, dx * fx + dz * fz
    xn, yn = xc / np.maximum(zc, 1e-3), yc / np.maximum(zc, 1e-3)
    r2 = xn * xn + yn * yn
    k = 1 + c['k1'] * r2 + c['k2'] * r2 * r2
    S = c['f'] * max(c['W'], c['H'])
    return c['W'] / 2 + S * xn * k, c['H'] / 2 - S * yn * k, zc


def photo(c):
    p = f"{WORK}/img/{c['id']}.jpg"
    for attempt in range(6):
        if os.path.exists(p):
            break
        try:
            data = urllib.request.urlopen(c['url'], timeout=60).read()
            Image.open(io.BytesIO(data)).load()  # keep only complete images
            open(p, 'wb').write(data)
        except Exception:
            time.sleep(1 + attempt)
    if not os.path.exists(p):
        return None
    im = Image.open(p).convert('RGB')
    return np.asarray(im, dtype=np.float32), im.width / c['W']


def straighten(w, c, img, sx):
    tw, th = max(8, int(w['L'] * PX_PER_M)), int(w['h'] * PX_PER_M)
    S, T = np.meshgrid((np.arange(tw) + 0.5) / tw, 1 - (np.arange(th) + 0.5) / th)
    X = w['a'][0] + (w['c'][0] - w['a'][0]) * S
    Z = w['a'][1] + (w['c'][1] - w['a'][1]) * S
    u, v, zc = project(c, X, T * w['h'], Z)
    u, v = u * sx, v * sx
    H, W = img.shape[:2]
    ok = (zc > 1) & (u >= 0) & (u < W - 1) & (v >= 0) & (v < H - 1)
    u0, v0 = np.clip(np.floor(u).astype(int), 0, W - 2), np.clip(np.floor(v).astype(int), 0, H - 2)
    du, dv = np.clip(u - u0, 0, 1)[..., None], np.clip(v - v0, 0, 1)[..., None]
    out = (img[v0, u0] * (1 - du) * (1 - dv) + img[v0, u0 + 1] * du * (1 - dv) + img[v0 + 1, u0] * (1 - du) * dv + img[v0 + 1, u0 + 1] * du * dv)
    return out, ok


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def usable(out, ok):
    """reject hazy, washed-out or barely visible samples"""
    if ok.mean() < 0.35:
        return False
    L = lum(out)[ok]
    return L.std() > 24 and L.mean() < 215


def shift(img, ok, dx, dy):
    o = np.zeros_like(img)
    k = np.zeros_like(ok)
    H, W = ok.shape
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    o[yd, xd] = img[ys, xs]
    k[yd, xd] = ok[ys, xs]
    return o, k


def align(ref, rok, img, ok):
    """small shift that best lines a sample up with the reference (GPS is off by a metre or two)"""
    best, arg = 1e9, (0, 0)
    R = lum(ref)
    for dy in range(-8, 9, 2):
        for dx in range(-16, 17, 2):
            o, k = shift(img, ok, dx, dy)
            both = rok & k
            if both.mean() < 0.25:
                continue
            e = np.abs(R[both] - lum(o)[both]).mean()
            if e < best:
                best, arg = e, (dx, dy)
    return shift(img, ok, *arg)


def hexc(c, boost=1.2):
    """hex colour, a little more saturated than the hazy photos"""
    hsv = cv2.cvtColor(np.uint8([[np.clip(c, 0, 255)]]), cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * boost, 0, 255)
    r, g, b = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)[0, 0]
    return '#%02x%02x%02x' % (r, g, b)


def colours(img, floors):
    """plaster, sign-board and shop-level colours of a straightened front (rows run top to bottom)"""
    H = img.shape[0]
    per = H / floors

    def zone(y0, y1):  # a band between heights y0 and y1 in metres
        r0, r1 = int(H - y1 / FLOOR * per), int(H - y0 / FLOOR * per)
        return img[max(0, r0):max(0, r1)].reshape(-1, 3).astype(np.float32)

    def stats(p):
        L = p @ np.float32([0.3, 0.59, 0.11])
        mx, mn = p.max(1), p.min(1)
        return L, (mx - mn) / np.maximum(mx, 1)

    up = zone(4.6, floors * FLOOR) if floors > 1 else zone(2.8, FLOOR)
    L, sat = stats(up)
    plain = (L > 45) & (L < 235) & (sat < 0.5) & ~((L > 195) & (sat < 0.12))
    wall = hexc(np.median(up[plain], 0), 1.1) if plain.sum() > 50 else None
    band = zone(2.6, min(4.8, floors * FLOOR))
    L, sat = stats(band)
    vivid = (sat > 0.3) & (L > 45) & (L < 235)
    signs = []
    if vivid.sum() > 80:
        Z = band[vivid]
        k = max(1, min(3, len(Z) // 60))
        _, lab, cen = cv2.kmeans(Z, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(lab.flatten(), minlength=k)
        signs = [hexc(cen[i], 1.3) for i in np.argsort(-counts) if counts[i] > 0.15 * len(Z)]
    ground = zone(0.3, 2.6)
    return {'wall': wall, 'signs': signs, 'ground': hexc(np.median(ground, 0)) if len(ground) else None,
            'sign_share': round(float(vivid.mean()), 2)}


fronts = []
for w in walls:
    ranked = sorted(((view_score(w, c), c) for c in cams), key=lambda t: -t[0])
    samples = []
    for score, c in [t for t in ranked if t[0] > 0][:8]:
        got = photo(c)
        if got is None:
            continue
        out, ok = straighten(w, c, *got)
        if usable(out, ok):
            samples.append((out, ok, c))
        if len(samples) == 5:
            break
    if not samples:
        continue
    ref, rok, _ = samples[0]
    stack, masks = [ref], [rok]
    for out, ok, c in samples[1:]:
        o, k = align(ref, rok, out, ok)
        stack.append(o)
        masks.append(k)
    S = np.stack(stack)
    Mk = np.stack(masks)
    # per-pixel median over the photos that see it: whatever moves (buses, people) mostly drops out
    Sm = np.where(Mk[..., None], S, np.nan)
    med = np.nanmedian(Sm, axis=0) if len(stack) > 1 else ref
    have = Mk.any(axis=0)
    med = np.where(have[..., None], med, 0)
    # sky above a lower building than the map guessed: cut the front down to whole floors that are wall
    L = lum(np.nan_to_num(med))
    sat = (np.nan_to_num(med).max(axis=2) - np.nan_to_num(med).min(axis=2)) / np.maximum(1, np.nan_to_num(med).max(axis=2))
    skyish = (L > 195) & (sat < 0.14)
    th = med.shape[0]
    floors = int(round(w['h'] / FLOOR))
    keep = floors
    for fl in range(floors, 0, -1):  # floors counted from the bottom; rows are top-down
        rows = slice(th - fl * th // floors, th - (fl - 1) * th // floors)
        good = have[rows].mean() > 0.6 and skyish[rows].mean() < 0.3
        if good:
            break
        keep = fl - 1
    if keep == 0:
        continue
    med = med[th - keep * th // floors:]
    have = have[th - keep * th // floors:]
    if have.mean() < 0.7:
        continue
    # fill what no photo saw with the average of its row, so the front has no holes
    for r in range(med.shape[0]):
        if have[r].any():
            med[r][~have[r]] = med[r][have[r]].mean(axis=0)
        else:
            med[r] = med[have].mean(axis=0)
    raw = np.clip(med, 0, 255).astype(np.uint8)
    best = np.clip(np.where(rok[..., None], ref, 0), 0, 255).astype(np.uint8)[th - keep * th // floors:]
    Image.fromarray(raw).save(f"{WORK}/refs/b{w['b']}_e{w['e']}_blend.png")
    Image.fromarray(best).save(f"{WORK}/refs/b{w['b']}_e{w['e']}_best.png")
    fronts.append({'b': w['b'], 'e': w['e'], 'L': round(w['L'], 2), 'floors': keep, **colours(raw, keep),
                   'photos': [c['id'] for _, _, c in samples], 'years': [c['year'] for _, _, c in samples]})
print(len(fronts), 'fronts measured', file=sys.stderr)
json.dump({'note': 'Colours read from street images (c) Mapillary contributors, CC BY-SA 4.0. b = building index in mirpur.json, e = edge.',
           'fronts': fronts}, open(OUT, 'w'), indent=0)
print(f'{len(fronts)} fronts written to {OUT}')
