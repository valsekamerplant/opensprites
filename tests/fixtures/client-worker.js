// OpenSpell 50ab3edf91c1c12468ec2b3ee6d5c380a168f091; MIT, see public/game/LICENSE
    function iU() {
      var e =
        (this && this.__awaiter) ||
        function (e, t, i, n) {
          return new (i || (i = Promise))(function (r, s) {
            function a(e) {
              try {
                l(n.next(e));
              } catch (e) {
                s(e);
              }
            }
            function o(e) {
              try {
                l(n.throw(e));
              } catch (e) {
                s(e);
              }
            }
            function l(e) {
              e.done
                ? r(e.value)
                : (function (e) {
                    return e instanceof i
                      ? e
                      : new i(function (t) {
                          t(e);
                        });
                  })(e.value).then(a, o);
            }
            l((n = n.apply(e, t || [])).next());
          });
        };
      const t = new Array(5),
        i = new Array(10),
        n = new Array(10),
        r = [167, 255, 255, 255],
        s = [94, 55, 35, 255];
      var a, o;
      function l() {
        (self.postMessage({
          type: o.type,
          result: !0,
          appearanceIds: o.appearanceIds,
          equippedItemIds: o.equippedItemIds,
          entityType: o.entityType,
          name: o.name,
          entityId: o.entityId,
          entityTypeId: o.entityTypeId,
          sessionId: o.sessionId,
        }),
          (o = null));
      }
      function h(e, t) {
        try {
          return -1 !== e[t][4];
        } catch (e) {
          return (console.error(e), !1);
        }
      }
      function c(e, t, i, n, r, s, a, o, l, h) {
        try {
          let c, d;
          if (
            (l
              ? ((c = i[n][3]), (d = i[n][4]))
              : ((c = i[n][0]), (d = i[n][1])),
            !u(c) || !u(d))
          )
            return;
          ((c += s),
            (function (e, t, i, n, r, s, a) {
              try {
                let o,
                  l,
                  h,
                  c,
                  u,
                  d = 0,
                  p = (t.height, t.width / 64),
                  f = i * (n ? 15 : 5),
                  _ = 64,
                  m = 128,
                  g = 2 === s && !a;
                r < 1
                  ? (e.save(), (e.globalAlpha = r))
                  : g && (e.save(), (e.globalAlpha = 0.65));
                for (let i = 0; i < 15; i++)
                  ((h = 64 * i),
                    (n || i % 3 == 0) &&
                      ((c = Math.floor(f / p)),
                      (u = f % p),
                      (o = 64 * u),
                      (l = 128 * c),
                      f++),
                    e.drawImage(t, o, l, _, m, h, d, _, m));
                (r < 1 || g) && e.restore();
              } catch (e) {
                console.error(e);
              }
            })(e, t[n][c], d, r, a, o, h));
        } catch (e) {
          console.error(e);
        }
      }
      function u(e) {
        return !(null === e || isNaN(e) || e < 0);
      }
      function d(e, t) {
        try {
          let i = e.getImageData(0, 0, 960, 128),
            n = i.data;
          for (let e = 0; e < n.length; e += 4)
            ((n[e] = (n[e] * t[0]) / 255),
              (n[e + 1] = (n[e + 1] * t[1]) / 255),
              (n[e + 2] = (n[e + 2] * t[2]) / 255));
          e.putImageData(i, 0, 0);
        } catch (e) {
          console.error(e);
        }
      }
      self.onmessage = (p) =>
        e(this, void 0, void 0, function* () {
          let f;
          switch (p.data.type) {
            case "initialize":
              ((a = p.data.canvas),
                (t[0] = [p.data.hair1Bitmap]),
                (t[1] = [p.data.beard1Bitmap]),
                (t[3] = [p.data.body1Bitmap]),
                (t[2] = [p.data.shirt1Bitmap]),
                (t[4] = [p.data.pants1Bitmap]),
                (i[0] = [p.data.helmet1Bitmap, p.data.helmetBack1Bitmap]),
                (i[1] = [p.data.chest1Bitmap]),
                (i[2] = [p.data.legs1Bitmap]),
                (i[3] = [p.data.shieldBack1Bitmap, p.data.shieldFront1Bitmap]),
                (i[4] = [p.data.weapon1Bitmap]),
                (i[5] = [p.data.backFront1Bitmap, p.data.backBack1Bitmap]),
                (i[6] = [p.data.neck1Bitmap]),
                (i[7] = [p.data.gloves1Bitmap]),
                (i[8] = [p.data.boots1Bitmap]),
                (i[9] = []),
                (n[0] = [p.data.helmetTrim1Bitmap]),
                (n[1] = [p.data.chestTrim1Bitmap]),
                (n[2] = [p.data.legsTrim1Bitmap]),
                (n[3] = [
                  p.data.shieldTrimBack1Bitmap,
                  p.data.shieldTrimFront1Bitmap,
                ]),
                (n[4] = []),
                (n[5] = []),
                (n[6] = []),
                (n[7] = []),
                (n[8] = []),
                (n[9] = []),
                (f = !0),
                self.postMessage({ type: p.data.type, result: f }));
              break;
            case "create":
              ((o = p.data),
                (f = yield (function (o, l, p, f, _, m, g) {
                  return e(this, void 0, void 0, function* () {
                    let e = a.getContext("2d");
                    e.clearRect(0, 0, a.width, a.height);
                    let _ = (function (e) {
                      try {
                        if (e[0] && 617 === e[0][2]) {
                          let e = new Array(10);
                          return ((e[0] = [0, 0, 617]), e);
                        }
                      } catch (e) {
                        console.error(e);
                      }
                      return null;
                    })(l);
                    (_ && c(e, i, _, 0, !1, 1, m, g, !1, !0),
                      c(e, i, l, 5, !0, 0, m, g, !1, !0),
                      c(e, i, l, 3, !0, 0, m, g, !1, !0),
                      h(l, 3) && c(e, n, l, 3, !0, 0, m, g, !0, !0),
                      c(e, t, o, 4, !0, 0, m, g, !1, !1),
                      (function (e) {
                        try {
                          let t = e[8][0],
                            i = e[2][0];
                          if (!u(t) || !u(i)) return !1;
                          let n = e[8][1],
                            r = e[2][1];
                          return !(
                            !u(n) ||
                            !u(r) ||
                            (function (e, t) {
                              if (0 === e)
                                switch (t) {
                                  case 9:
                                  case 10:
                                  case 11:
                                  case 12:
                                  case 13:
                                  case 14:
                                    return !0;
                                }
                              return !1;
                            })(i, r)
                          );
                        } catch (e) {
                          return (console.error(e), !1);
                        }
                      })(l)
                        ? (c(e, i, l, 2, !0, 0, m, g, !1, !0),
                          h(l, 2) && c(e, n, l, 2, !0, 0, m, g, !0, !0),
                          c(e, i, l, 8, !0, 0, m, g, !1, !0))
                        : (c(e, i, l, 8, !0, 0, m, g, !1, !0),
                          c(e, i, l, 2, !0, 0, m, g, !1, !0),
                          h(l, 2) && c(e, n, l, 2, !0, 0, m, g, !0, !0)),
                      c(e, t, o, 3, !0, 0, m, g, !1, !1),
                      f || c(e, t, o, 2, !0, 0, m, g, !1, !1),
                      (function (e) {
                        try {
                          let t = e[7][0],
                            i = e[1][0];
                          if (!u(t) || !u(i)) return !1;
                          let n = e[7][1],
                            r = e[1][1];
                          return !(
                            !u(n) ||
                            !u(r) ||
                            (function (e, t) {
                              if (0 === e)
                                switch (t) {
                                  case 9:
                                  case 10:
                                  case 11:
                                  case 12:
                                  case 13:
                                  case 14:
                                  case 15:
                                    return !0;
                                }
                              return !1;
                            })(i, r) ||
                            ((function (e, t) {
                              if (0 === e)
                                switch (t) {
                                  case 0:
                                  case 1:
                                  case 2:
                                  case 3:
                                  case 4:
                                  case 6:
                                  case 7:
                                  case 8:
                                    return !0;
                                }
                              return !1;
                            })(i, r) &&
                              (function (e, t) {
                                if (0 === e)
                                  switch (t) {
                                    case 13:
                                    case 14:
                                    case 15:
                                    case 16:
                                    case 19:
                                    case 20:
                                      return !0;
                                  }
                                return !1;
                              })(t, n))
                          );
                        } catch (e) {
                          return (console.error(e), !1);
                        }
                      })(l)
                        ? (c(e, i, l, 1, !0, 0, m, g, !1, !0),
                          h(l, 1) && c(e, n, l, 1, !0, 0, m, g, !0, !0),
                          c(e, i, l, 7, !0, 0, m, g, !1, !0))
                        : (c(e, i, l, 7, !0, 0, m, g, !1, !0),
                          c(e, i, l, 1, !0, 0, m, g, !1, !0),
                          h(l, 1) && c(e, n, l, 1, !0, 0, m, g, !0, !0)));
                    let v = (function (e) {
                      try {
                        switch (e[7][2]) {
                          case 611:
                          case 612:
                          case 613:
                          case 614:
                          case 615:
                          case 616: {
                            let e = new Array(10);
                            return ((e[7] = [0, 12, 480]), e);
                          }
                        }
                      } catch (e) {
                        console.error(e);
                      }
                      return null;
                    })(l);
                    switch (
                      (v && c(e, i, v, 7, !0, 0, m, g, !1, !0),
                      c(e, i, l, 6, !1, 0, m, g, !1, !0),
                      c(e, i, l, 5, !0, 1, m, g, !1, !0),
                      p ||
                        (c(e, t, o, 1, !1, 0, m, g, !1, !1),
                        c(e, t, o, 0, !1, 0, m, g, !1, !1)),
                      c(e, i, l, 0, !1, 0, m, g, !1, !0),
                      h(l, 0) && c(e, n, l, 0, !1, 0, m, g, !0, !0),
                      c(e, i, l, 3, !0, 1, m, g, !1, !0),
                      h(l, 3) && c(e, n, l, 3, !0, 1, m, g, !0, !0),
                      c(e, i, l, 4, !0, 0, m, g, !1, !0),
                      g)
                    ) {
                      case 1:
                        !(function (e) {
                          try {
                            let t = e.getImageData(0, 0, 960, 128),
                              i = t.data;
                            for (let e = 0; e < i.length; e += 4) {
                              let t =
                                0.299 * i[e] +
                                0.587 * i[e + 1] +
                                0.114 * i[e + 2];
                              ((i[e] = t), (i[e + 1] = t), (i[e + 2] = t));
                            }
                            e.putImageData(t, 0, 0);
                          } catch (e) {
                            console.error(e);
                          }
                        })(e);
                        break;
                      case 2:
                        !(function (e) {
                          d(e, r);
                        })(e);
                        break;
                      case 3:
                        !(function (e) {
                          d(e, s);
                        })(e);
                    }
                    return !0;
                  });
                })(
                  o.appearanceIds,
                  o.equippedItemIds,
                  o.doesHelmetHideSpritesUnderneath,
                  o.doesChestHideSpritesUnderneath,
                  o.doLegsHideSpritesUnderneath,
                  o.opacity,
                  o.filter,
                )),
                requestAnimationFrame(l));
              break;
            default:
              ((f = !1), self.postMessage({ type: p.data.type, result: f }));
          }
        });
    }

iU();
