"""Finding where the ball lands: a made-up ball falling, bouncing, flying on."""
import numpy as np
import pytest

from setme_vision.court import Court, POINTS
from setme_vision.landing import bounces, landing_after, place
from tests.test_court import seen as on_camera

H = 1080


def path(t_land=1.0, x_land=900.0, y_land=800.0, fps=30, phase=0.0, vx=300.0, fall=900.0, rise=-450.0, g=1200.0):
    """A ball moving right, falling to y_land at t_land, then bouncing up more slowly. phase: where the contact falls
    between frames (0 to 1)."""
    out = []
    for i in range(60):
        t = t_land - 1 + (i + phase) / fps
        dt = t - t_land
        v0 = fall if dt < 0 else rise
        out.append((t, x_land + vx * dt, y_land + v0 * dt + g / 2 * dt * dt))
    return out


def test_finds_the_bounce_between_frames():
    for phase in (0.0, 0.3, 0.7):
        [b] = bounces(path(phase=phase), H)
        assert b.t == pytest.approx(1.0, abs=0.004)              # better than a frame (0.033 s)
        assert b.x == pytest.approx(900, abs=3) and b.y == pytest.approx(800, abs=3)


def test_an_arc_in_the_air_is_not_a_landing():
    apex = [(i / 30, 300 + 10 * i, 800 - 600 * (i / 30) + 600 * (i / 30) ** 2) for i in range(60)]   # up then down
    assert bounces(apex, H) == []


def test_a_ball_that_stops_dead_counts():
    pts = [(t, x, min(y, 800.0)) for t, x, y in path(rise=0.0, g=0.0)]
    pts = [(t, x if t <= 1.0 else 900.0, y) for t, x, y in pts]
    [b] = bounces(pts, H)
    assert b.t == pytest.approx(1.0, abs=0.04)


def test_landing_after_the_last_touch_uses_frame_heights():
    seen = [(t, [(x / H, y / H), (0.1, 0.1)]) for t, x, y in path(t_land=5.0)]      # plus a still blob
    l = landing_after(seen, last_t=4.2, height=H)
    assert l is not None and l.t == pytest.approx(5.0, abs=0.01)
    assert landing_after(seen, last_t=6.2, height=H) is None    # nothing lands after that (less the 1 s allowed for late tags)


def test_place_puts_the_bottom_of_the_ball_on_the_court():
    court = Court(on_camera(list(POINTS)))
    floor = court.image([(8.5, 4.0)])[0]                        # the ball touches the floor here
    l = place(bounces(path(x_land=floor[0], y_land=floor[1] - 12), H)[0], court)
    assert l.spot[0] == pytest.approx(8.5, abs=0.15) and l.spot[1] == pytest.approx(4.0, abs=0.4)
    assert l.call == 'in'
