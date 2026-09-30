"""Distances on the ground, for dispatch and the arrival check."""

import math

_EARTH_M = 6371000.0


def metres_between(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres, or None when a point is missing.

    0, 0 counts as missing: it is what an empty Float field holds, and a real
    rider in the Gulf of Guinea is not a case this business has.
    """
    if not (lat1 or lng1) or not (lat2 or lng2):
        return None
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lng / 2) ** 2)
    return _EARTH_M * 2 * math.asin(math.sqrt(a))


def say_distance(metres):
    """"420 m" or "1.2 km", for notes a person reads."""
    if metres is None:
        return ''
    if metres < 1000:
        return '%d m' % round(metres)
    return '%.1f km' % (metres / 1000.0)
