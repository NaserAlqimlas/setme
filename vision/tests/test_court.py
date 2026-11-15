"""The court in metres: placing floor points from a few clicked marks, and calling in or out."""
import numpy as np
import pytest

from setme_vision.court import POINTS, Court, call, spread_out

# A made-up camera behind the near end line, a little to the left: the court as a trapezoid, far end narrower.
CAMERA = np.array([[95.0, 22.0, 380.0], [0.0, -14.0, 1000.0], [0.0, 0.035, 1.0]])


def seen(names):
    world = np.float64([POINTS[n] for n in names])
    img = (CAMERA @ np.c_[world, np.ones(len(world))].T).T
    return {n: tuple(p[:2] / p[2]) for n, p in zip(names, img)}


def test_four_marks_place_any_floor_point():
    c = Court(seen(['near left corner', 'near right corner', 'centre line, left', 'centre line, right']))
    assert c.error < 0.01
    for spot in [(4.5, 4.5), (8.9, 1.2), (2.0, 15.0), (-0.5, 18.4)]:
        px = c.image([spot])[0]
        assert c.place([px])[0] == pytest.approx(spot, abs=1e-6)


def test_more_marks_average_out_clicking_errors():
    names = list(POINTS)
    rng = np.random.default_rng(0)
    marks = {n: (x + rng.normal(0, 1.5), y + rng.normal(0, 1.5)) for n, (x, y) in seen(names).items()}
    c = Court(marks)
    true = Court(seen(names))
    assert c.error > 0.1                                  # the clicks don't quite agree, and it says so
    px = true.image([(4.5, 3.0)])
    assert c.place(px)[0] == pytest.approx((4.5, 3.0), abs=0.1)


def test_points_on_one_line_are_refused():
    assert not spread_out([(0, 0), (0, 6), (0, 9), (9, 9)])        # three on the left sideline
    assert spread_out([(0, 0), (9, 0), (0, 9), (9, 9)])
    with pytest.raises(ValueError):
        Court(seen(['near left corner', 'near attack line, left', 'centre line, left', 'far left corner']))
    with pytest.raises(ValueError):
        Court(seen(['near left corner', 'near right corner', 'centre line, left']))


def test_far_away_a_pixel_covers_more_floor():
    c = Court(seen(list(POINTS)))
    near, far = c.image([(4.5, 1.0), (4.5, 17.0)])
    assert c.blur(far) > 2 * c.blur(near)


def test_calls():
    assert call((4.5, 4.5), blur=0.1) == 'in'
    assert call((9.02, 4.0), blur=0.01) == 'in'        # on the line: lines are in
    assert call((9.3, 4.0), blur=0.1) == 'out'
    assert call((4.0, -0.5), blur=0.1) == 'out'        # past the near end line
    assert call((9.1, 4.0), blur=0.2) == 'close'       # just out, but the picture can't tell that finely
    assert call((4.0, 17.9), blur=0.3) == 'close'
