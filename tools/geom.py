#!/usr/bin/env python3
"""生成三维坐标：分子（静态）和反应（关键帧），写入 src/geom.js。

坐标由标准键长、键角手工搭出（内坐标 → 直角坐标），关键帧之间用刚体最小二乘叠合（Kabsch）
衔接。它们是示意用的几何，不是量化计算的反应路径。

改完运行：python3 tools/geom.py && python3 tools/build.py
"""
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
Z = np.array([0.0, 0.0, 1.0])


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def nerf(a, b, c, r, ang, dih):
    """新原子接在 c 上：键长 r，键角 b-c-new，二面角 a-b-c-new。"""
    ang, dih = math.radians(ang), math.radians(dih)
    bc = unit(c - b)
    n = np.cross(b - a, bc)
    if np.linalg.norm(n) < 1e-8:
        n = np.cross(bc, Z)
        if np.linalg.norm(n) < 1e-8:
            n = np.cross(bc, [0, 1.0, 0])
    n = unit(n)
    m = np.cross(n, bc)
    return c + r * (-math.cos(ang) * bc + math.sin(ang) * math.cos(dih) * m + math.sin(ang) * math.sin(dih) * n)


class Mol:
    def __init__(self):
        self.names, self.el, self.pts, self.bonds = [], [], [], []

    def __getitem__(self, name):
        return self.pts[self.names.index(name)]

    def i(self, name):
        return self.names.index(name)

    def add(self, name, el, to=None, r=None, a=None, ang=None, d=None, dih=None, order=1):
        if to is None:
            p = np.zeros(3)
        elif a is None:
            p = self[to] + np.array([r, 0, 0])
        elif d is None:
            c, b = self[to], self[a]
            v, th = -unit(c - b), math.radians(ang)
            p = c + r * np.array([v[0] * math.cos(th) - v[1] * math.sin(th), v[0] * math.sin(th) + v[1] * math.cos(th), 0])
        else:
            p = nerf(self[d], self[a], self[to], r, ang, dih)
        self.names.append(name)
        self.el.append(el)
        self.pts.append(np.asarray(p, float))
        if to is not None and order:
            self.bonds.append((to, name, order))
        return self

    def methyl(self, c, n, ref, tag):
        for k, dih in enumerate((60, 180, 300), 1):
            self.add(f"{tag}{k}", "H", c, 1.09, n, 110, ref, dih)
        return self

    def xyz(self, names=None):
        return np.array([self[n] for n in (names or self.names)])

    def out(self):
        c = self.xyz()
        c = c - c.mean(0)
        return {
            "el": self.el,
            "xyz": [[round(float(v), 3) for v in p] for p in c],
            "bonds": [[self.i(a), self.i(b), o] for a, b, o in self.bonds],
        }


def kabsch(P, Q):
    Pc, Qc = P.mean(0), Q.mean(0)
    U, _, Vt = np.linalg.svd((P - Pc).T @ (Q - Qc))
    d = np.sign(np.linalg.det(Vt.T @ U.T)) or 1.0
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, Qc - R @ Pc


def fit(mol, names, targets):
    """把 mol 刚体叠合到 targets（与 names 一一对应），返回 {原子名: 坐标}。"""
    R, t = kabsch(mol.xyz(names), np.array(targets))
    return {n: R @ mol[n] + t for n in mol.names}


# ---------- 分子 ----------
def dma():
    m = Mol().add("N", "N").add("C1", "C", "N", 1.458).add("C2", "C", "N", 1.458, "C1", 112)
    m.add("HN", "H", "N", 1.019, "C1", 109, "C2", 120)
    return m.methyl("C1", "N", "C2", "H1").methyl("C2", "N", "C1", "H2")


def dmf():
    m = Mol().add("C", "C").add("O", "O", "C", 1.22, order=2).add("N", "N", "C", 1.35, "O", 125)
    m.add("C1", "C", "N", 1.45, "C", 120, "O", 0).add("C2", "C", "N", 1.45, "C", 122, "O", 180)
    m.add("Hf", "H", "C", 1.10, "N", 113, "C1", 180)
    return m.methyl("C1", "N", "C", "H1").methyl("C2", "N", "C", "H2")


def ndma():
    m = Mol().add("Na", "N").add("Nn", "N", "Na", 1.34).add("On", "O", "Nn", 1.23, "Na", 114, order=2)
    m.add("C1", "C", "Na", 1.45, "Nn", 120, "On", 0).add("C2", "C", "Na", 1.45, "Nn", 117, "On", 180)
    return m.methyl("C1", "Na", "Nn", "H1").methyl("C2", "Na", "Nn", "H2")


def hono():
    m = Mol().add("N", "N").add("Od", "O", "N", 1.17, order=2).add("Oh", "O", "N", 1.43, "Od", 110.7)
    return m.add("H", "H", "Oh", 0.96, "N", 102, "Od", 180)


def n2o3():
    m = Mol().add("Nt", "N").add("Nn", "N", "Nt", 1.86).add("On", "O", "Nn", 1.14, "Nt", 105, order=2)
    m.add("Ot1", "O", "Nt", 1.21, "Nn", 112, "On", 0, order=1.5)
    return m.add("Ot2", "O", "Nt", 1.21, "Nn", 117, "On", 180, order=1.5)


def water():
    return Mol().add("O", "O").add("H1", "H", "O", 0.96).add("H2", "H", "O", 0.96, "H1", 104.5)


def formic():
    m = Mol().add("C", "C").add("Od", "O", "C", 1.20, order=2).add("Oh", "O", "C", 1.34, "Od", 125)
    m.add("HO", "H", "Oh", 0.97, "C", 107, "Od", 0)
    return m.add("HC", "H", "C", 1.10, "Oh", 110, "HO", 180)


def hn3():
    m = Mol().add("N1", "N").add("H", "H", "N1", 1.02).add("N2", "N", "N1", 1.24, "H", 109, order=2)
    return m.add("N3", "N", "N2", 1.13, "N1", 171, "H", 180, order=2)


def linear(names, els, lens, orders):
    m = Mol().add(names[0], els[0])
    x = 0.0
    for k in range(1, len(names)):
        x += lens[k - 1]
        m.names.append(names[k]); m.el.append(els[k]); m.pts.append(np.array([x, 0.0, 0.0]))
        m.bonds.append((names[k - 1], names[k], orders[k - 1]))
    return m


def ring(n, r, start):
    return [np.array([r * math.cos(math.radians(start + 360 / n * k)), r * math.sin(math.radians(start + 360 / n * k)), 0]) for k in range(n)]


def tetrazole():
    """1H-四唑母体：C5、N1(H)、N2、N3、N4。"""
    m = Mol()
    names = ["C5", "N1", "N2", "N3", "N4"]
    for nme, p in zip(names, ring(5, 1.131, 180)):
        m.names.append(nme); m.el.append("C" if nme == "C5" else "N"); m.pts.append(p)
    m.bonds += [("C5", "N1", 1), ("N1", "N2", 1), ("N2", "N3", 2), ("N3", "N4", 1), ("N4", "C5", 2)]
    for nme, to, r in (("H5", "C5", 1.08), ("H1", "N1", 1.01)):
        m.names.append(nme); m.el.append("H"); m.pts.append(m[to] + r * unit(m[to])); m.bonds.append((to, nme, 1))
    return m


# ---------- 反应关键帧 ----------
def frames_out(order, frames):
    """order: 原子名列表；frames: [(坐标字典, 键表)]，键表里用原子名。"""
    allpts = np.array([[f[0][n] for n in order] for f in frames])
    centre = allpts.reshape(-1, 3).mean(0)
    out = []
    for pts, bonds in frames:
        out.append({
            "xyz": [[round(float(v), 3) for v in (pts[n] - centre)] for n in order],
            "bonds": [[order.index(a), order.index(b), o] for a, b, o in bonds],
        })
    return out


def shifted(pts, names, vec):
    q = dict(pts)
    for n in names:
        q[n] = pts[n] + np.asarray(vec, float)
    return q


def rx_nitrosation():
    """(CH3)2NH + N2O3 → (CH3)2N–N=O + HONO"""
    A, B, P, H = dma(), n2o3(), ndma(), hono()
    hs = [f"H{c}{k}" for c in (1, 2) for k in (1, 2, 3)]
    order = ["N", "C1", "C2", "HN", *hs, "Nn", "On", "Nt", "Ot1", "Ot2"]
    e = {n: A[n] for n in A.names}
    e["Nn"] = nerf(A["C2"], A["C1"], A["N"], 2.3, 108, -120)          # 沿孤对电子方向
    e["Nt"] = nerf(e["HN"], e["N"], e["Nn"], 1.86, 100, 0)            # 硝基一侧朝向 N–H
    cands = [nerf(e["Nt"], e["N"], e["Nn"], 1.14, 112, s * 111) for s in (1, -1)]
    e["On"] = min(cands, key=lambda p: np.linalg.norm(p - e["C1"]))   # 亚硝基氧靠近 C1（产物里 syn）
    e["Ot1"] = nerf(e["N"], e["Nn"], e["Nt"], 1.21, 112, 0)
    e["Ot2"] = nerf(e["N"], e["Nn"], e["Nt"], 1.21, 117, 180)
    nitro = ["Nn", "On", "Nt", "Ot1", "Ot2"]
    rough = e["Nn"]
    e.update(fit(B, nitro, [e[n] for n in nitro]))                    # 用理想 N2O3 取代粗摆的坐标
    e = shifted(e, nitro, rough - e["Nn"])                            # 叠合后把亚硝基 N 拉回进攻位置
    axis = unit(np.mean([e[n] for n in nitro], 0) - e["N"])
    r = shifted(e, nitro, 2.6 * axis)

    p0 = dict(e)
    nn = e["N"] + 1.5 * unit(e["Nn"] - e["N"])
    f = fit(P, ["Na", "Nn", "On", "C1", "C2"], [e["N"], nn, e["On"] + (nn - e["Nn"]), e["C1"], e["C2"]])
    for n in ["C1", "C2", *hs, "Nn", "On"]:
        p0[n] = f[n]
    p0["N"] = f["Na"]
    p0["HN"] = p0["N"] + 1.04 * unit(e["HN"] - e["N"])
    leave = unit(e["Nt"] - e["Nn"])
    for n in ("Nt", "Ot1", "Ot2"):
        p0[n] = e[n] + 0.95 * leave

    p1 = dict(p0)
    ndma_names = ["N", "C1", "C2", *hs, "Nn", "On"]
    away = unit(np.mean([p0[n] for n in ("Nt", "Ot1", "Ot2")], 0) - np.mean([p0[n] for n in ndma_names], 0))
    tg = {n: p0[n] + 1.1 * away for n in ("Nt", "Ot1", "Ot2")}
    hh = tg["Ot1"] + 0.97 * unit(p0["HN"] - tg["Ot1"])
    g = fit(H, ["N", "Od", "Oh", "H"], [tg["Nt"], tg["Ot2"], tg["Ot1"], hh])
    p1.update({"Nt": g["N"], "Ot2": g["Od"], "Ot1": g["Oh"], "HN": g["H"]})
    p2 = shifted(p1, ["Nt", "Ot1", "Ot2", "HN"], 2.3 * away)

    ch = [("C1", h, 1) for h in hs[:3]] + [("C2", h, 1) for h in hs[3:]]
    base = [("N", "C1", 1), ("N", "C2", 1), *ch]
    n2 = [("Nn", "On", 2), ("Nt", "Ot1", 1.5), ("Nt", "Ot2", 1.5)]
    b_r = base + [("N", "HN", 1), ("Nn", "Nt", 1)] + n2
    b_e = b_r + [("N", "Nn", 0.5)]
    b_p0 = base + [("N", "HN", 1), ("N", "Nn", 1)] + n2
    b_p1 = base + [("N", "Nn", 1), ("Nn", "On", 2), ("Nt", "Ot2", 2), ("Nt", "Ot1", 1), ("Ot1", "HN", 1)]
    el = ["N", "C", "C", "H", *["H"] * 6, "N", "O", "N", "O", "O"]
    return {"el": el, "frames": frames_out(order, [(r, b_r), (e, b_e), (p0, b_p0), (p1, b_p1), (p2, b_p1)])}


def rx_hydrolysis():
    """HCON(CH3)2 + H2O → HCOOH + HN(CH3)2"""
    A, W, F, D = dmf(), water(), formic(), dma()
    hs = [f"H{c}{k}" for c in (1, 2) for k in (1, 2, 3)]
    order = ["C", "O", "N", "Hf", "C1", "C2", *hs, "Ow", "Hw1", "Hw2"]
    e = {n: A[n] for n in A.names}
    nrm = unit(np.cross(e["O"] - e["C"], e["N"] - e["C"]))
    ow = e["C"] + 1.95 * nrm
    t1 = ow + 0.96 * unit(unit(e["C"] - e["N"]) * 0.8 + nrm * 0.6)
    t2 = ow + 0.96 * unit((e["N"] - ow) + 1.3 * nrm)
    w = fit(W, ["O", "H1", "H2"], [ow, t1, t2])
    e.update({"Ow": w["O"], "Hw1": w["H1"], "Hw2": w["H2"]})
    wat = ["Ow", "Hw1", "Hw2"]
    r = shifted(e, wat, 2.6 * nrm + 0.8 * unit(e["C"] - e["N"]))

    v = unit(e["N"] - e["C"])
    p0 = dict(e)
    f = fit(F, ["C", "Od", "Oh", "HC"], [e["C"], e["O"], e["Ow"] - 0.5 * nrm, e["Hf"]])
    p0.update({"C": f["C"], "O": f["Od"], "Ow": f["Oh"], "Hf": f["HC"], "Hw1": f["HO"]})
    amine = ["N", "C1", "C2"]
    tg = [e[n] + 1.0 * v for n in amine] + [e["N"] + 1.0 * v + 0.95 * nrm]
    d = fit(D, ["N", "C1", "C2", "HN"], tg)
    p0.update({"N": d["N"], "C1": d["C1"], "C2": d["C2"], "Hw2": d["HN"], **{h: d[h] for h in hs}})
    p1 = shifted(p0, ["N", "C1", "C2", "Hw2", *hs], 2.3 * v)
    p1 = shifted(p1, ["C", "O", "Ow", "Hf", "Hw1"], -0.5 * v)

    ch = [("C1", h, 1) for h in hs[:3]] + [("C2", h, 1) for h in hs[3:]]
    base = [("C", "O", 2), ("C", "Hf", 1), ("N", "C1", 1), ("N", "C2", 1), *ch, ("Ow", "Hw1", 1)]
    b_r = base + [("C", "N", 1), ("Ow", "Hw2", 1)]
    b_e = b_r + [("C", "Ow", 0.5)]
    b_p = base + [("C", "Ow", 1), ("N", "Hw2", 1)]
    el = ["C", "O", "N", "H", "C", "C", *["H"] * 6, "O", "H", "H"]
    return {"el": el, "frames": frames_out(order, [(r, b_r), (e, b_e), (p0, b_p), (p1, b_p)])}


def rx_tetrazole():
    """Ar–C≡N + N3⁻ → 四唑负离子 →(H+) 1H-四唑；Ar 以苯基示意。平面反应，z = 0。"""
    order = [f"C{k}" for k in range(1, 7)] + [f"H{k}" for k in range(2, 7)] + ["C7", "Nx", "Na", "Nb", "Nc", "Hp"]
    cr, hr = ring(6, 1.397, 0), ring(6, 2.48, 0)
    base = {f"C{k + 1}": cr[k] for k in range(6)}
    base.update({f"H{k + 1}": hr[k] for k in range(1, 6)})
    P = lambda x, y: np.array([x, y, 0.0])
    cen = P(2.867 + 1.131, 0)
    pent = {n: cen + p for n, p in zip(["C7", "Na", "Nb", "Nc", "Nx"], ring(5, 1.131, 180))}  # C5 N1 N2 N3 N4
    pent = {k: P(v[0], -v[1]) if k in ("Na", "Nb", "Nc", "Nx") else v for k, v in pent.items()}
    # ring() 逆时针排：180°, 252°, 324°, 36°, 108°；翻转 y 后 N1 在上方，腈基 N（N4）摆到下方
    f0 = {**base, "C7": P(2.837, 0), "Nx": P(3.997, 0), "Na": P(4.3, 3.6), "Nb": P(5.38, 3.13), "Nc": P(6.46, 2.66), "Hp": P(1.3, 4.3)}
    f1 = {**base, "C7": P(2.84, 0), "Nx": P(3.98, -0.22), "Na": P(3.45, 2.3), "Nb": P(4.55, 1.9), "Nc": P(5.62, 1.46), "Hp": P(1.5, 4.1)}
    f2 = {**base, "C7": P(2.86, 0), "Nx": P(3.80, -0.86), "Na": P(3.58, 1.22), "Nb": P(4.78, 1.36), "Nc": P(5.72, 0.72), "Hp": P(1.7, 3.9)}
    f3 = {**base, **pent, "Hp": P(2.3, 3.5)}
    f4 = dict(f3)
    f4["Hp"] = pent["Na"] + 1.01 * unit(pent["Na"] - cen)
    ph = [(f"C{k}", f"C{k % 6 + 1}", 1.5) for k in range(1, 7)] + [(f"C{k}", f"H{k}", 1) for k in range(2, 7)] + [("C1", "C7", 1)]
    b0 = ph + [("C7", "Nx", 3), ("Na", "Nb", 2), ("Nb", "Nc", 2)]
    b1 = b0 + [("C7", "Na", 0.5)]
    b2 = ph + [("C7", "Nx", 2), ("C7", "Na", 1), ("Na", "Nb", 1), ("Nb", "Nc", 2), ("Nc", "Nx", 0.4)]
    b3 = ph + [("C7", "Nx", 1.5), ("C7", "Na", 1.5), ("Na", "Nb", 1.5), ("Nb", "Nc", 1.5), ("Nc", "Nx", 1.5)]
    b4 = ph + [("C7", "Nx", 2), ("C7", "Na", 1), ("Na", "Nb", 1), ("Nb", "Nc", 2), ("Nc", "Nx", 1), ("Na", "Hp", 1)]
    el = ["C"] * 6 + ["H"] * 5 + ["C", "N", "N", "N", "N", "H"]
    return {"el": el, "frames": frames_out(order, [(f0, b0), (f1, b1), (f2, b2), (f3, b3), (f4, b4)])}


def rx_protonation():
    """NO2⁻ + H+ → HONO；HONO + H+ → H2O + NO+"""
    order = ["N", "Oa", "Ob", "H1", "H2"]
    H, W = hono(), water()
    nit = Mol().add("N", "N").add("Oa", "O", "N", 1.24, order=1.5).add("Ob", "O", "N", 1.24, "Oa", 115, order=1.5)
    k1 = fit(H, ["N", "Od", "Oh"], [nit["N"], nit["Oa"], nit["Ob"]])
    f1 = {"N": k1["N"], "Oa": k1["Od"], "Ob": k1["Oh"], "H1": k1["H"]}
    out = unit(f1["Ob"] - f1["N"])
    side = unit(np.cross(Z, out))
    f1["H2"] = f1["Ob"] + 2.4 * unit(out * 0.4 - side)
    f0 = {"N": nit["N"], "Oa": nit["Oa"], "Ob": nit["Ob"], "H1": nit["Ob"] + 2.6 * unit(f1["H1"] - f1["Ob"]), "H2": f1["H2"] + 1.6 * unit(out * 0.4 - side)}
    ob = f1["N"] + 1.85 * out
    w = fit(W, ["O", "H1", "H2"], [ob, ob + 0.96 * unit(out * 0.55 + side), ob + 0.96 * unit(out * 0.55 - side)])
    f2 = {"N": f1["N"], "Oa": f1["N"] + 1.10 * unit(f1["Oa"] - f1["N"]), "Ob": w["O"], "H1": w["H1"], "H2": w["H2"]}
    f3 = shifted(f2, ["Ob", "H1", "H2"], 2.3 * out)
    f3["Oa"] = f2["N"] + 1.06 * unit(f2["Oa"] - f2["N"])
    b0 = [("N", "Oa", 1.5), ("N", "Ob", 1.5)]
    b1 = [("N", "Oa", 2), ("N", "Ob", 1), ("Ob", "H1", 1)]
    b2 = [("N", "Oa", 2.5), ("N", "Ob", 0.5), ("Ob", "H1", 1), ("Ob", "H2", 1)]
    b3 = [("N", "Oa", 3), ("Ob", "H1", 1), ("Ob", "H2", 1)]
    return {"el": ["N", "O", "O", "H", "H"], "frames": frames_out(order, [(f0, b0), (f1, b1), (f2, b2), (f3, b3)])}


def rx_quench():
    """N3⁻ + NO+ → N3–N=O → N2 + N2O"""
    order = ["Na", "Nb", "Nc", "N4", "O"]
    I = Mol().add("Nc", "N").add("Nb", "N", "Nc", 1.13).add("Na", "N", "Nb", 1.25, "Nc", 174)
    I.add("N4", "N", "Na", 1.45, "Nb", 110, "Nc", 180).add("O", "O", "N4", 1.17, "Na", 112, "Nb", 180)
    k2 = {n: I[n] for n in I.names}
    az = linear(["Na", "Nb", "Nc"], "NNN", [1.18, 1.18], [2, 2])
    no = linear(["N4", "O"], "NO", [1.06], [3])
    a = unit(k2["N4"] - k2["Na"])
    fa = fit(az, ["Na", "Nb", "Nc"], [k2[n] for n in ("Na", "Nb", "Nc")])
    fn = fit(no, ["N4", "O"], [k2["N4"], k2["O"]])
    k1 = {**{n: fa[n] - 0.45 * a for n in fa}, **{n: fn[n] + 0.45 * a for n in fn}}
    k0 = {**{n: fa[n] - 1.5 * a for n in fa}, **{n: fn[n] + 1.7 * a for n in fn}}
    n2 = linear(["Nb", "Nc"], "NN", [1.10], [3])
    n2o = linear(["Na", "N4", "O"], "NNO", [1.13, 1.19], [2.5, 1.5])
    go = unit(k2["Nc"] - k2["Na"])
    f2 = fit(n2, ["Nb", "Nc"], [k2["Nb"] + 0.9 * go, k2["Nc"] + 0.9 * go])
    f3 = fit(n2o, ["Na", "N4", "O"], [k2[n] for n in ("Na", "N4", "O")])
    k3 = {**f2, **f3}
    k4 = {**{n: f2[n] + 2.2 * go for n in f2}, **{n: f3[n] - 0.9 * go for n in f3}}
    b0 = [("Na", "Nb", 2), ("Nb", "Nc", 2), ("N4", "O", 3)]
    b1 = b0 + [("Na", "N4", 0.5)]
    b2 = [("Nc", "Nb", 2.5), ("Nb", "Na", 1.5), ("Na", "N4", 1), ("N4", "O", 2)]
    b3 = [("Nc", "Nb", 3), ("Na", "N4", 2.5), ("N4", "O", 1.5)]
    return {"el": ["N", "N", "N", "N", "O"], "frames": frames_out(order, [(k0, b0), (k1, b1), (k2, b2), (k3, b3), (k4, b3)])}


def main():
    mols = {"dmf": dmf(), "dma": dma(), "ndma": ndma(), "hono": hono(), "n2o3": n2o3(), "tetrazole": tetrazole(), "hn3": hn3()}
    data = {
        "mol": {k: m.out() for k, m in mols.items()},
        "rx": {
            "tetrazole": rx_tetrazole(), "protonation": rx_protonation(), "quench": rx_quench(),
            "hydrolysis": rx_hydrolysis(), "nitrosation": rx_nitrosation(),
        },
    }
    # 自检：键长落在合理范围，原子不互相重叠
    for k, m in data["mol"].items():
        c = np.array(m["xyz"])
        for i, j, o in m["bonds"]:
            d = np.linalg.norm(c[i] - c[j])
            assert 0.9 < d < 1.95, (k, i, j, d)
    for k, r in data["rx"].items():
        for n, f in enumerate(r["frames"]):
            c = np.array(f["xyz"])
            assert len(c) == len(r["el"]), k
            for i, j, o in f["bonds"]:
                d = np.linalg.norm(c[i] - c[j])
                lim = 2.9 if o < 1 else 1.95
                assert 0.85 < d < lim, (k, n, r["el"][i], r["el"][j], i, j, o, round(d, 2))
            dm = np.linalg.norm(c[:, None] - c[None], axis=-1) + np.eye(len(c)) * 9
            i, j = np.unravel_index(dm.argmin(), dm.shape)
            assert dm.min() > 0.8, (k, n, "atoms overlap", i, j, round(dm.min(), 2))
            print(f"{k:12s} frame {n}: closest pair {r['el'][i]}{i}-{r['el'][j]}{j} {dm.min():.2f} Å")
    (ROOT / "src/geom.js").write_text("const GEOM = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    print("wrote src/geom.js")


if __name__ == "__main__":
    main()
