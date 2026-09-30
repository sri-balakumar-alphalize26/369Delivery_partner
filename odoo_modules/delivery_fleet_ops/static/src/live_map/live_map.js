/*global L*/
/**
 * Where every rider is, for the office.
 *
 * Polls `sa.fleet.map.snapshot` every fifteen seconds and redraws: riders
 * (green free, orange carrying work, grey when their last position is older
 * than Delivery Settings allows), the shops, a dashed line from each rider to
 * their next stop, and the last half hour of the selected rider's trail.
 *
 * Leaflet is the module's own copy, loaded only when this screen opens - the
 * same way Odoo's delivery app loads it for its pickup-point picker.
 */

import { Component, onMounted, onWillStart, onWillUnmount, useRef, useState } from "@odoo/owl";
import { loadCSS, loadJS } from "@web/core/assets";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { escape } from "@web/core/utils/strings";
import { standardActionServiceProps } from "@web/webclient/actions/action_service";

const POLL_MS = 15000;
const LIB = "/delivery_fleet_ops/static/lib/leaflet";

const COLORS = {
    free: "#1E8E4E",
    busy: "#F26B1D",
    stale: "#9AA1B1",
    off: "#9AA1B1",
    nofix: "#9AA1B1",
    shop: "#1B2A4A",
};

export class LiveMap extends Component {
    static template = "delivery_fleet_ops.LiveMap";
    static props = { ...standardActionServiceProps };

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.mapRef = useRef("map");
        this.state = useState({
            riders: [],
            shops: [],
            trail: [],
            staleAfter: 600,
            selectedId: this.props.action?.context?.rider_id || null,
            updatedAt: null,
            error: null,
        });
        this.fitted = false;

        onWillStart(async () => {
            await Promise.all([loadJS(`${LIB}/leaflet.js`), loadCSS(`${LIB}/leaflet.css`)]);
            await this.refresh();
        });

        onMounted(() => {
            this.map = L.map(this.mapRef.el, { zoomControl: true });
            this.map.attributionControl.setPrefix(
                '<a href="https://leafletjs.com" target="_blank">Leaflet</a>'
            );
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution:
                    "&copy; <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>",
            }).addTo(this.map);
            this.layers = {
                shops: L.layerGroup().addTo(this.map),
                lines: L.layerGroup().addTo(this.map),
                trail: L.layerGroup().addTo(this.map),
                riders: L.layerGroup().addTo(this.map),
            };
            // A sensible place to start before anything has a position:
            // Muscat, where the business is.
            this.map.setView([23.588, 58.3829], 11);
            // Leaflet measures its box once; the action container settles
            // its size a moment later, which left grey squares of unloaded
            // tiles along the edges.
            this.sizeTimer = setTimeout(() => this.map?.invalidateSize(), 200);
            this.draw();
            this.timer = setInterval(() => this.refresh().then(() => this.draw()), POLL_MS);
        });

        onWillUnmount(() => {
            clearInterval(this.timer);
            clearTimeout(this.sizeTimer);
            this.map?.remove();
        });
    }

    // ------------------------------------------------------------------ data

    async refresh() {
        try {
            const snap = await this.orm.call("sa.fleet.map", "snapshot", [], {
                rider_id: this.state.selectedId || false,
            });
            Object.assign(this.state, {
                riders: snap.riders,
                shops: snap.shops,
                trail: snap.trail,
                staleAfter: snap.stale_after_s,
                updatedAt: new Date(),
                error: null,
            });
        } catch (e) {
            // Keep the last picture on screen; say it may be out of date.
            this.state.error = e?.data?.message || e?.message || _t("Could not refresh.");
        }
    }

    async onRefreshClick() {
        await this.refresh();
        this.draw();
    }

    // --------------------------------------------------------------- display

    status(rider) {
        if (rider.lat === null || rider.lat === undefined) {
            return "nofix";
        }
        if (rider.fix_age_s > this.state.staleAfter) {
            return "stale";
        }
        if (!rider.on_duty) {
            return "off";
        }
        return rider.load ? "busy" : "free";
    }

    color(rider) {
        return COLORS[this.status(rider)];
    }

    statusLabel(rider) {
        const s = this.status(rider);
        if (s === "nofix") {
            return _t("No position yet");
        }
        if (s === "stale") {
            // Grey on the map, so not "Free": nobody knows where they are.
            return rider.on_duty ? _t("Not seen lately") : _t("Off duty");
        }
        if (!rider.on_duty) {
            return _t("Off duty");
        }
        if (rider.load) {
            return rider.load === 1 ? _t("1 job") : _t("%s jobs", rider.load);
        }
        return _t("Free");
    }

    seenLabel(rider) {
        if (rider.fix_age_s === null || rider.fix_age_s === undefined) {
            return "";
        }
        const s = rider.fix_age_s;
        if (s < 60) {
            return _t("just now");
        }
        if (s < 3600) {
            return _t("%s min ago", Math.floor(s / 60));
        }
        return _t("%s h ago", Math.floor(s / 3600));
    }

    batteryLabel(rider) {
        return rider.battery ? `${Math.round(rider.battery * 100)}%` : "";
    }

    initials(name) {
        return (name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0].toUpperCase())
            .join("");
    }

    draw() {
        if (!this.map) {
            return;
        }
        const { shops, lines, trail, riders } = this.layers;
        shops.clearLayers();
        lines.clearLayers();
        trail.clearLayers();
        riders.clearLayers();
        const bounds = [];

        for (const shop of this.state.shops) {
            L.marker([shop.lat, shop.lng], {
                icon: L.divIcon({
                    className: "o_fleet_shop_icon",
                    html: `<div class="o_fleet_shop"><i class="fa fa-shopping-bag"></i></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                }),
                title: shop.name,
            })
                .bindTooltip(escape(shop.name))
                .addTo(shops);
            bounds.push([shop.lat, shop.lng]);
        }

        for (const rider of this.state.riders) {
            if (rider.lat === null || rider.lat === undefined) {
                continue;
            }
            const color = this.color(rider);
            const selected = rider.id === this.state.selectedId;
            const plate = rider.vehicle ? ` · ${escape(rider.vehicle.plate)}` : "";
            L.marker([rider.lat, rider.lng], {
                icon: L.divIcon({
                    className: "o_fleet_rider_icon",
                    html:
                        `<div class="o_fleet_pin${selected ? " o_selected" : ""}" style="background:${color}">` +
                        `${escape(this.initials(rider.name))}</div>` +
                        `<div class="o_fleet_label">${escape(rider.name)}${plate}</div>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17],
                }),
                zIndexOffset: selected ? 1000 : 0,
            })
                .on("click", () => this.select(rider.id))
                .addTo(riders);
            bounds.push([rider.lat, rider.lng]);

            for (const job of rider.jobs) {
                if (job.target) {
                    L.polyline(
                        [
                            [rider.lat, rider.lng],
                            [job.target.lat, job.target.lng],
                        ],
                        { color, weight: 2, dashArray: "6 6", opacity: 0.8 }
                    )
                        .bindTooltip(`${escape(job.ref)} → ${escape(job.target_name)}`)
                        .addTo(lines);
                }
            }
        }

        if (this.state.trail.length > 1) {
            L.polyline(
                this.state.trail.map((p) => [p.lat, p.lng]),
                { color: "#3B5BDB", weight: 4, opacity: 0.7 }
            ).addTo(trail);
        }

        // Frame everything once; after that the map is the office's to move.
        if (!this.fitted && bounds.length) {
            this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
            this.fitted = true;
        }
    }

    // --------------------------------------------------------------- actions

    async select(riderId) {
        this.state.selectedId = this.state.selectedId === riderId ? null : riderId;
        await this.refresh();
        this.draw();
        const rider = this.state.riders.find((r) => r.id === this.state.selectedId);
        if (rider && rider.lat !== null && rider.lat !== undefined) {
            this.map.setView([rider.lat, rider.lng], Math.max(this.map.getZoom(), 15));
        }
    }

    openRider(riderId) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "sa.delivery.partner",
            res_id: riderId,
            views: [[false, "form"]],
        });
    }

    openJob(jobId) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "stock.picking",
            res_id: jobId,
            views: [[false, "form"]],
        });
    }

    get updatedLabel() {
        return this.state.updatedAt ? this.state.updatedAt.toLocaleTimeString() : "";
    }

    get counts() {
        const out = { free: 0, busy: 0, grey: 0 };
        for (const r of this.state.riders) {
            const s = this.status(r);
            if (s === "free") {
                out.free++;
            } else if (s === "busy") {
                out.busy++;
            } else {
                out.grey++;
            }
        }
        return out;
    }
}

registry.category("actions").add("delivery_fleet_ops.live_map", LiveMap);
