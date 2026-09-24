import asyncio
import unittest
from unittest import mock

from app import weather


def run(coro):
    return asyncio.run(coro)


class WeatherCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        weather._reset_for_tests()

    def test_unset_coordinates_yield_no_chip_rather_than_a_guess(self) -> None:
        with mock.patch.object(weather.settings, "weather_lat", None), \
             mock.patch.object(weather.settings, "weather_lon", None):
            self.assertIsNone(run(weather.get_weather()))

    def test_transient_failure_keeps_serving_the_last_good_reading(self) -> None:
        good = {"temp_c": 22.2, "text": "overcast"}
        clock = [1000.0]
        with mock.patch.object(weather.time, "monotonic", lambda: clock[0]):
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=good)):
                self.assertEqual(run(weather.get_weather()), good)

            # Inside the success TTL: no new call at all.
            fetch = mock.AsyncMock(return_value=None)
            with mock.patch.object(weather, "_fetch", fetch):
                clock[0] += 10
                self.assertEqual(run(weather.get_weather()), good)
                fetch.assert_not_awaited()

            # TTL expired and the poll fails: the previous reading survives.
            clock[0] += weather.CACHE_TTL_SEC + 1
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=None)):
                self.assertEqual(run(weather.get_weather()), good)

            # And it retries on the short interval, not the full TTL.
            clock[0] += weather.RETRY_AFTER_SEC + 1
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value={"temp_c": 19.0})):
                self.assertEqual(run(weather.get_weather()), {"temp_c": 19.0})

    def test_a_reading_too_old_to_refresh_is_dropped_not_shown_stale(self) -> None:
        good = {"temp_c": 22.2}
        clock = [1000.0]
        with mock.patch.object(weather.time, "monotonic", lambda: clock[0]):
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=good)):
                self.assertEqual(run(weather.get_weather()), good)
            clock[0] += weather.MAX_STALE_SEC + 1
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=None)):
                self.assertIsNone(run(weather.get_weather()))

    def test_never_having_reached_the_service_yields_none(self) -> None:
        with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=None)):
            self.assertIsNone(run(weather.get_weather()))

    def test_a_point_does_not_replace_the_house_reading(self) -> None:
        house = {"temp_c": 22.2, "text": "overcast"}
        there = {"temp_c": 40.0, "text": "clear", "lat": 33.96, "lon": -116.5}
        clock = [1000.0]
        with mock.patch.object(weather.time, "monotonic", lambda: clock[0]):
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=house)):
                self.assertEqual(run(weather.get_weather()), house)
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=there)) as fetch:
                got = run(weather.get_weather_at(33.961, -116.501))
                self.assertEqual(got, there)
                fetch.assert_awaited()
            # House cache is untouched, and a second point read is served from its own slot.
            clock[0] += 10
            with mock.patch.object(weather, "_fetch", mock.AsyncMock(return_value=None)) as fetch:
                self.assertEqual(run(weather.get_weather()), house)
                self.assertEqual(run(weather.get_weather_at(33.961, -116.501)), there)
                fetch.assert_not_awaited()

    def test_a_point_outside_the_globe_is_refused(self) -> None:
        self.assertIsNone(run(weather.get_weather_at(120, 0)))
        self.assertIsNone(run(weather.get_weather_at(0, 200)))


class WmoTest(unittest.TestCase):
    def test_bearing_buckets(self) -> None:
        self.assertEqual(weather._bearing(0), "N")
        self.assertEqual(weather._bearing(90), "E")
        self.assertEqual(weather._bearing(359), "N")
        self.assertIsNone(weather._bearing(None))
        self.assertIsNone(weather._bearing("x"))


if __name__ == "__main__":
    unittest.main()
