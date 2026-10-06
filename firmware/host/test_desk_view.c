#include "desk_view.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static void roster_json(char *buf, size_t len, int count, int running_at) {
    size_t used = 0;
    int i;
    used += (size_t)snprintf(buf, len, "{\"phase\":\"running\",\"agents\":[");
    for (i = 0; i < count; i++) {
        used += (size_t)snprintf(
            buf + used, len - used, "%s{\"id\":\"a%02d\",\"title\":\"Agent %d\",\"status\":\"%s\"}",
            i ? "," : "", i, i, i == running_at ? "running" : "idle");
    }
    snprintf(buf + used, len - used, "]}");
}

int main(void) {
    desk_view_t view;
    char label[32];
    const char *sample =
        "{\"phase\":\"running\",\"needs_you\":false,\"agents\":[{\"id\":\"a1\",\"status\":\"running\"}],"
        "\"last_event\":{\"title\":\"Scaffold\",\"message\":\"Pick one\"},\"events\":[]}";
    check(desk_view_from_json(sample, &view) == 0, "sample parse");
    check(strcmp(view.title, "Scaffold") == 0, "title");
    check(strcmp(view.message, "Pick one") == 0, "message");
    check(strcmp(desk_face_title(&view), "Scaffold") == 0, "launch stays the headline");
    check(view.running_count == 1, "running count");
    check(view.known_count == 1, "one known");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "1/1 running") == 0, "one of one");
    check(strcmp(desk_phase_label(&view, 0), "RUNNING") == 0, "running label");
    check(desk_quiet_idle(&view, 0) == 0, "running is not quiet");

    const char *spaced =
        "{ \"phase\": \"running\", \"needs_you\": false, \"agents\": ["
        "{ \"id\": \"a1\", \"status\": \"running\" }],"
        " \"last_event\": { \"title\": \"Scaffold\", \"message\": \"Pick one\" }, \"events\": [] }";
    check(desk_view_from_json(spaced, &view) == 0, "spaced parse");
    check(view.running_count == 1, "spaced count");
    check(strcmp(view.title, "Scaffold") == 0, "spaced title");

    const char *needs =
        "{ \"phase\": \"needs_you\", \"needs_you\": true, \"agents\": ["
        "{ \"id\": \"a1\", \"status\": \"needs_you\" } ],"
        " \"last_event\": { \"title\": \"Scaffold\", \"message\": \"Pick one\" }, \"events\": [] }";
    check(desk_view_from_json(needs, &view) == 0, "needs parse");
    check(view.needs_you == 1, "needs flag");
    check(strcmp(view.phase, "needs_you") == 0, "needs phase");
    check(strcmp(desk_phase_label(&view, 0), "NEEDS YOU") == 0, "needs label");
    check(desk_quiet_idle(&view, 0) == 0, "needs you is not quiet");

    const char *idle =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[],\"last_event\":null,\"events\":[]}";
    check(desk_view_from_json(idle, &view) == 0, "idle parse");
    check(view.title[0] == '\0', "empty title");
    check(desk_face_title(&view)[0] == '\0', "empty headline");
    check(desk_face_title(NULL)[0] == '\0', "null headline");
    check(view.known_count == 0 && view.running_count == 0, "empty store");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "idle") == 0, "empty count is idle");
    desk_count_text(NULL, label, sizeof(label));
    check(strcmp(label, "idle") == 0, "null view is idle");
    check(strcmp(desk_phase_label(&view, 0), "IDLE") == 0, "idle label");
    check(desk_quiet_idle(&view, 0) == 1, "idle is quiet");
    check(desk_show_sleep(&view, 0) == 1, "empty desk shows sleep");
    check(desk_quiet_idle(&view, 2) == 1, "two misses still quiet");
    check(desk_show_sleep(&view, 2) == 1, "two misses still show sleep");
    check(strcmp(desk_phase_label(&view, 3), "link down") == 0, "link down");
    check(desk_quiet_idle(&view, 3) == 0, "link down is not quiet");
    check(desk_show_sleep(&view, 3) == 0, "link down hides sleep");
    check(desk_quiet_idle(NULL, 0) == 0, "null view is not quiet");
    check(desk_show_sleep(NULL, 0) == 0, "null view hides sleep");
    check(desk_view_from_json(NULL, &view) == -1, "null json");

    const char *napping =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[{\"id\":\"a1\",\"status\":\"idle\"}]}";
    check(desk_view_from_json(napping, &view) == 0, "napping parse");
    check(view.running_count == 0 && view.agent_count == 1 && view.known_count == 1, "idle agent");
    check(desk_quiet_idle(&view, 0) == 1, "idle agent still quiet");
    check(desk_show_sleep(&view, 0) == 0, "idle agent hides sleep");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "idle") == 0, "idle agent count stays idle");

    const char *busy =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[{\"id\":\"a1\",\"status\":\"running\"}]}";
    check(desk_view_from_json(busy, &view) == 0, "busy phase idle parse");
    check(desk_quiet_idle(&view, 0) == 0, "running agent is not quiet");

    desk_panel_t panel;
    const char *pushed =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[],\"last_event\":null,\"events\":[],"
        "\"panel\":{\"url\":\"http://192.168.4.30:8787\",\"token\":\"desk-secret\"}}";
    check(desk_view_from_json(pushed, &view) == 0, "view ignores panel");
    check(strcmp(view.phase, "idle") == 0, "panel doc phase");
    check(desk_panel_from_json(pushed, &panel) == 0, "panel parse");
    check(panel.present == 1, "panel present");
    check(panel.token_set == 1, "panel token set");
    check(strcmp(panel.url, "http://192.168.4.30:8787") == 0, "panel url");
    check(strcmp(panel.token, "desk-secret") == 0, "panel token");
    check(desk_panel_should_apply(&panel, "http://192.168.4.30:8787", "old") == 1, "token differs");
    check(desk_panel_should_apply(&panel, "http://10.0.0.2:8787", "desk-secret") == 1, "url differs");
    check(desk_panel_should_apply(&panel, "http://192.168.4.30:8787", "desk-secret") == 0, "same");

    const char *absent =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[],\"last_event\":{"
        "\"title\":\"see panel\",\"message\":\"url stays\"},\"events\":[]}";
    check(desk_panel_from_json(absent, &panel) == 0, "no panel key");
    check(panel.present == 0, "absent present");
    check(desk_panel_should_apply(&panel, "http://192.168.4.30:8787", "") == 0, "absent apply");

    const char *url_only =
        "{\"panel\":{\"url\":\"http://192.168.4.40:8787\"},\"phase\":\"idle\"}";
    check(desk_panel_from_json(url_only, &panel) == 0, "url only parse");
    check(panel.present == 1 && panel.token_set == 0, "url only flags");
    check(desk_panel_should_apply(&panel, "http://192.168.4.40:8787", "keep") == 0, "keep token");
    check(desk_panel_should_apply(&panel, "http://192.168.4.30:8787", "keep") == 1, "url only change");

    const char *cleared =
        "{\"panel\":{\"url\":\"http://192.168.4.30:8787\",\"token\":\"\"}}";
    check(desk_panel_from_json(cleared, &panel) == 0, "clear token parse");
    check(panel.token_set == 1 && panel.token[0] == '\0', "empty token");
    check(desk_panel_should_apply(&panel, "http://192.168.4.30:8787", "desk-secret") == 1, "clear token");
    check(desk_panel_adopt(&panel, "http://192.168.4.30:8787", "desk-secret", 0) == 1, "same host needs no probe");
    check(desk_panel_from_json(pushed, &panel) == 0, "adopt panel again");
    check(desk_panel_adopt(&panel, "http://10.0.0.8:8787", "desk-secret", 0) == 0, "dead push stays put");
    check(desk_panel_adopt(&panel, "http://10.0.0.8:8787", "desk-secret", 1) == 1, "live push is stored");
    check(desk_panel_adopt(&panel, "http://192.168.4.30:8787", "desk-secret", 0) == 0, "same pair is not a push");

    const char *decoy =
        "{\"phase\":\"idle\",\"last_event\":{\"message\":\"see \\\"panel\\\": "
        "{\\\"url\\\":\\\"http://evil\\\"}\"},\"events\":[]}";
    check(desk_panel_from_json(decoy, &panel) == 0, "decoy parse");
    check(panel.present == 0, "quoted panel is not a push");

    check(desk_panel_from_json(NULL, &panel) == -1, "null panel json");
    check(desk_panel_from_json("{\"panel\":null}", &panel) == 0 && panel.present == 0, "null panel");

    const char *marked =
        "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
        "{\"id\":\"a1\",\"title\":\"Scaffold\",\"color\":\"#C45C26\",\"shape\":\"diamond\"},"
        "{\"id\":\"a2\",\"title\":\"\",\"color\":\"\",\"shape\":\"\"},"
        "{\"id\":\"a3\",\"title\":\"Hex\",\"color\":\"coral\",\"shape\":\"nope\"},"
        "{\"id\":\"a4\",\"title\":\"Sq\",\"color\":\"224466\",\"shape\":\"square\"},"
        "{\"id\":\"a5\",\"title\":\"Tri\",\"color\":\"#112233\",\"shape\":\"triangle\"},"
        "{\"id\":\"a6\",\"title\":\"Circ\",\"color\":\"#abcdef\",\"shape\":\"circle\"},"
        "{\"id\":\"a7\",\"title\":\"Drop\",\"color\":\"#010101\",\"shape\":\"square\"}"
        "],\"last_event\":null,\"events\":[]}";
    uint32_t color = 0;
    check(desk_view_from_json(marked, &view) == 0, "marked parse");
    check(view.agent_count == 7, "seven rows kept");
    check(view.known_count == 7, "seven known");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "idle") == 0, "no running status is idle");
    check(strcmp(view.agents[0].title, "Scaffold") == 0, "agent title");
    check(strcmp(view.agents[0].color, "#C45C26") == 0, "agent color");
    check(strcmp(view.agents[0].shape, "diamond") == 0, "agent shape");
    check(desk_mark_shape(view.agents[0].shape) == DESK_SHAPE_DIAMOND, "diamond kind");
    check(desk_mark_color(view.agents[0].color, &color) == 0, "hex color");
    check(color == 0xc45c26u, "hex value");
    check(view.agents[1].color[0] == '\0', "omitted color");
    check(view.agents[1].shape[0] == '\0', "omitted shape");
    check(desk_mark_color(view.agents[1].color, &color) == -1, "empty color rejected");
    check(desk_mark_shape(view.agents[1].shape) == DESK_SHAPE_CIRCLE, "neutral shape");
    check(desk_mark_color(view.agents[2].color, &color) == -1, "named color rejected");
    check(desk_mark_shape(view.agents[2].shape) == DESK_SHAPE_CIRCLE, "unknown shape");
    check(desk_mark_color(view.agents[3].color, &color) == 0 && color == 0x224466u, "bare hex");
    check(desk_mark_shape(view.agents[4].shape) == DESK_SHAPE_TRIANGLE, "triangle kind");
    check(desk_mark_shape(view.agents[5].shape) == DESK_SHAPE_CIRCLE, "explicit circle");
    check(strcmp(view.agents[5].id, "a6") == 0, "sixth kept");
    check(strcmp(view.agents[6].id, "a7") == 0, "seventh kept");
    check(desk_mark_color(NULL, &color) == -1, "null color");
    check(desk_mark_shape(NULL) == DESK_SHAPE_CIRCLE, "null shape");
    check(desk_mark_shape("Diamond") == DESK_SHAPE_DIAMOND, "shape case");
    {
        static const struct {
            const char *name;
            int kind;
        } shapes[] = {
            {"cloud", DESK_SHAPE_CLOUD},
            {"rounded", DESK_SHAPE_ROUNDED},
            {"rounded_square", DESK_SHAPE_ROUNDED},
            {"Rounded_Square", DESK_SHAPE_ROUNDED},
            {"star", DESK_SHAPE_STAR},
            {"flower", DESK_SHAPE_FLOWER},
            {"clover", DESK_SHAPE_FLOWER},
            {"heart", DESK_SHAPE_HEART},
            {"blob", DESK_SHAPE_BLOB},
            {"splatter", DESK_SHAPE_BLOB},
            {"drop", DESK_SHAPE_DROP},
            {"teardrop", DESK_SHAPE_DROP},
            {"pill", DESK_SHAPE_PILL},
            {"capsule", DESK_SHAPE_PILL},
            {"pentagon", DESK_SHAPE_PENTAGON},
            {"shield", DESK_SHAPE_PENTAGON},
            {"sun", DESK_SHAPE_SUN},
            {"gear", DESK_SHAPE_SUN},
            {"hex", DESK_SHAPE_HEXAGON},
            {"hexagon", DESK_SHAPE_HEXAGON},
            {"circle", DESK_SHAPE_CIRCLE},
            {"nope", DESK_SHAPE_CIRCLE},
        };
        int i;
        for (i = 0; i < (int)(sizeof(shapes) / sizeof(shapes[0])); i++) {
            char msg[48];
            snprintf(msg, sizeof(msg), "shape %s", shapes[i].name);
            check(desk_mark_shape(shapes[i].name) == shapes[i].kind, msg);
        }
        check(DESK_SHAPE_DIAMOND != DESK_SHAPE_SQUARE && DESK_SHAPE_CLOUD != DESK_SHAPE_SQUARE &&
                  DESK_SHAPE_CLOUD != DESK_SHAPE_CIRCLE && DESK_SHAPE_STAR != DESK_SHAPE_SQUARE &&
                  DESK_SHAPE_TRIANGLE != DESK_SHAPE_SQUARE,
              "diamond, cloud, star, and triangle are not squares");
    }
    const char *rounded =
        "{\"phase\":\"idle\",\"agents\":[{\"id\":\"r\",\"title\":\"Round\",\"shape\":\"rounded_square\"}]}";
    check(desk_view_from_json(rounded, &view) == 0, "rounded parse");
    check(strcmp(view.agents[0].shape, "rounded_square") == 0, "rounded square kept");
    check(desk_mark_shape(view.agents[0].shape) == DESK_SHAPE_ROUNDED, "rounded square kind");

    const char *dismissed =
        "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
        "{\"id\":\"a1\",\"title\":\"Scaffold\",\"status\":\"running\"}],"
        "\"last_event\":{\"type\":\"note\",\"source\":\"manual\",\"title\":\"Dismissed\","
        "\"message\":\"\"},\"events\":[]}";
    check(desk_view_from_json(dismissed, &view) == 0, "dismiss parse");
    check(strcmp(view.title, "Dismissed") == 0, "raw dismiss title");
    check(desk_face_title(&view)[0] == '\0', "dismiss is not the headline");
    check(view.message[0] == '\0', "dismiss has no message");

    const char *note =
        "{\"phase\":\"idle\",\"last_event\":{\"type\":\"note\",\"source\":\"grok-bot\","
        "\"title\":\"Remember\",\"message\":\"milk\"}}";
    check(desk_view_from_json(note, &view) == 0, "note parse");
    check(strcmp(desk_face_title(&view), "Remember") == 0, "note title stays");

    const char *question =
        "{\"phase\":\"needs_you\",\"needs_you\":true,\"last_event\":{\"type\":\"agent.needs_you\","
        "\"source\":\"grok-bot\",\"title\":\"Scaffold\",\"message\":\"Pick one\"}}";
    check(desk_view_from_json(question, &view) == 0, "question parse");
    check(strcmp(desk_face_title(&view), "Scaffold") == 0, "question title stays");

    const char *pair =
        "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
        "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\","
        "\"color\":\"#c45c26\",\"shape\":\"diamond\"},"
        "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\",\"shape\":\"square\"}"
        "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"started\"},\"events\":[]}";
    check(desk_view_from_json(pair, &view) == 0, "pair parse");
    check(view.agent_count == 2, "pair rows");
    check(strcmp(view.agents[0].title, "Scaffold") == 0, "scaffold title");
    check(strcmp(view.agents[1].title, "Jeeves") == 0, "jeeves title");
    check(desk_mark_shape(view.agents[0].shape) == DESK_SHAPE_DIAMOND, "scaffold mark");
    check(desk_mark_shape(view.agents[1].shape) == DESK_SHAPE_SQUARE, "jeeves mark");
    check(view.running_count == 1 && view.known_count == 2, "one of two running");
    check(strcmp(desk_face_title(&view), "Scaffold") == 0, "pair headline");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "1/2 running") == 0, "pair count");

    const char *both_idle =
        "{\"phase\":\"idle\",\"agents\":["
        "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"idle\"},"
        "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\"}]}";
    check(desk_view_from_json(both_idle, &view) == 0, "both idle parse");
    check(view.agent_count == 2 && view.known_count == 2, "idle rows stay");
    check(view.running_count == 0, "neither running");
    check(strcmp(view.agents[0].title, "Scaffold") == 0, "idle scaffold title");
    desk_count_text(&view, label, sizeof(label));
    check(strcmp(label, "idle") == 0, "zero running is idle");

    {
        char roster[4096];
        char id[8];
        roster_json(roster, sizeof(roster), 17, 16);
        check(desk_view_from_json(roster, &view) == 0, "roster parse");
        check(view.agent_count == 17, "seventeen rows");
        check(view.known_count == 17, "seventeen known");
        check(view.running_count == 1, "one runner in the roster");
        check(strcmp(view.agents[0].title, "Agent 0") == 0, "first row");
        check(strcmp(view.agents[16].id, "a16") == 0, "seventeenth row");
        desk_count_text(&view, label, sizeof(label));
        check(strcmp(label, "1/17 running") == 0, "dock counts the roster");

        roster_json(roster, sizeof(roster), DESK_AGENT_MAX + 1, DESK_AGENT_MAX);
        check(desk_view_from_json(roster, &view) == 0, "over cap parse");
        check(view.agent_count == DESK_AGENT_MAX, "row cap");
        check(view.known_count == DESK_AGENT_MAX + 1, "known past the row cap");
        check(view.running_count == 1, "runner past the row cap still counts");
        snprintf(id, sizeof(id), "a%02d", DESK_AGENT_MAX - 1);
        check(strcmp(view.agents[DESK_AGENT_MAX - 1].id, id) == 0, "last kept row");
        desk_count_text(&view, label, sizeof(label));
        check(strcmp(label, "1/25 running") == 0, "dock counts past the rows");
    }

    {
        desk_view_t again;
        const char *roster =
            "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
            "{\"id\":\"a\",\"title\":\"Aye\",\"status\":\"running\",\"color\":\"#112233\",\"shape\":\"circle\"},"
            "{\"id\":\"b\",\"title\":\"Bee\",\"status\":\"idle\"}]}";
        const char *needs_row =
            "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
            "{\"id\":\"a\",\"title\":\"Aye\",\"status\":\"running\",\"color\":\"#112233\",\"shape\":\"circle\"},"
            "{\"id\":\"b\",\"title\":\"Bee\",\"status\":\"needs_you\"}]}";
        const char *flipped =
            "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
            "{\"id\":\"b\",\"title\":\"Bee\",\"status\":\"idle\"},"
            "{\"id\":\"a\",\"title\":\"Aye\",\"status\":\"running\",\"color\":\"#112233\",\"shape\":\"circle\"}]}";
        check(desk_view_from_json(roster, &view) == 0, "same roster");
        check(desk_view_from_json(roster, &again) == 0, "same roster again");
        check(desk_view_same(&view, &again) == 1, "repeat parse is the same view");
        check(strcmp(view.agents[1].status, "idle") == 0, "idle status kept");
        check(desk_view_from_json(needs_row, &again) == 0, "status row parse");
        check(again.running_count == view.running_count, "status swap keeps the running count");
        check(again.needs_you == 1, "needs you row raises the alert");
        check(desk_view_same(&view, &again) == 0, "agent status is a view change");
        check(desk_view_from_json(flipped, &again) == 0, "flipped parse");
        check(desk_view_same(&view, &again) == 0, "agent order is a view change");
        check(desk_view_from_json(roster, &again) == 0, "roster for the failure count");
        check(desk_status_same(&view, 0, &again, 0) == 1, "same view and failures");
        check(desk_status_same(&view, 2, &again, 2) == 1, "matching misses");
        check(desk_status_same(&view, 0, &again, 1) == 0, "failure count is a status change");
        check(desk_view_from_json(needs_row, &again) == 0, "needs row for status");
        check(desk_status_same(&view, 0, &again, 0) == 0, "row change is a status change");
        check(desk_status_same(NULL, 0, &view, 0) == 0, "missing left view");
        check(desk_status_same(&view, 0, NULL, 0) == 0, "missing right view");
    }

    {
        desk_view_t idle;
        desk_view_t running;
        const char *idle_json = "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[]}";
        const char *running_json =
            "{\"phase\":\"running\",\"needs_you\":false,\"agents\":[{\"id\":\"a1\",\"status\":\"running\"}]}";
        check(desk_view_from_json(idle_json, &idle) == 0, "idle for poll");
        check(desk_view_from_json(running_json, &running) == 0, "running for poll");
        check(desk_poll_ms(&idle, 0, 1) == 10000, "quiet idle waits");
        check(desk_poll_ms(&idle, 0, 0) == 2000, "bad link stays fast");
        check(desk_poll_ms(&idle, 2, 1) == 2000, "misses stay fast");
        check(desk_poll_ms(&idle, 3, 1) == 2000, "link down stays fast");
        check(desk_poll_ms(&running, 0, 1) == 2000, "running stays fast");
        idle.needs_you = 1;
        check(desk_poll_ms(&idle, 0, 1) == 2000, "needs you stays fast");
        check(desk_poll_ms(NULL, 0, 1) == 2000, "missing view stays fast");
    }

    {
        const char *aside = "x";
        const char *named =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"},"
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\"}"
            "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"started\"}}";
        const char *split =
            "{\"phase\":\"needs_you\",\"needs_you\":true,\"agents\":["
            "{\"id\":\"a\",\"title\":\"Aye\",\"status\":\"running\"},"
            "{\"id\":\"b\",\"title\":\"Bee\",\"status\":\"needs_you\"}"
            "],\"last_event\":{\"title\":\"Aye\",\"message\":\"Pick one\"}}";
        const char *question =
            "{\"phase\":\"needs_you\",\"agents\":["
            "{\"id\":\"b\",\"title\":\"Bee\",\"status\":\"needs_you\"}],"
            "\"last_event\":{\"message\":\"Pick one\"}}";
        const char *quiet =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"}],"
            "\"last_event\":{\"title\":\"Scaffold\",\"message\":\"\"}}";
        const char *by_id =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"\",\"status\":\"running\"}],"
            "\"last_event\":{\"title\":\"scaffold\",\"message\":\"started\"}}";
        check(desk_view_from_json(named, &view) == 0, "aside parse");
        check(desk_agent_hot(&view, 0, &aside) == 1, "fresh message highlights");
        check(strcmp(aside, "started") == 0, "message on the named row");
        check(desk_agent_hot(&view, 1, &aside) == 0, "idle row stays quiet");
        check(aside[0] == '\0', "quiet row has no aside");
        check(desk_view_from_json(split, &view) == 0, "split parse");
        check(desk_agent_hot(&view, 0, &aside) == 1, "owner row is hot");
        check(strcmp(aside, "Pick one") == 0, "owner shows the question");
        check(desk_agent_hot(&view, 1, &aside) == 1, "needs you highlights");
        check(aside[0] == '\0', "needs you without the face text");
        check(desk_view_from_json(question, &view) == 0, "untitled question");
        check(desk_agent_hot(&view, 0, &aside) == 1, "untitled needs you is hot");
        check(strcmp(aside, "Pick one") == 0, "untitled needs you carries the message");
        check(desk_view_from_json(quiet, &view) == 0, "empty message parse");
        check(desk_agent_hot(&view, 0, &aside) == 0, "running with no message stays plain");
        check(aside[0] == '\0', "empty message is not aside text");
        check(desk_view_from_json(by_id, &view) == 0, "id headline parse");
        check(desk_agent_hot(&view, 0, &aside) == 1, "id match highlights");
        check(strcmp(aside, "started") == 0, "id match shows the message");
        check(desk_agent_hot(NULL, 0, &aside) == 0, "null view is not hot");
        check(aside[0] == '\0', "null view clears aside");
        check(desk_agent_hot(&view, -1, &aside) == 0, "bad index");
        check(desk_agent_hot(&view, 4, NULL) == 0, "aside pointer is optional");
    }

    {
        desk_view_t prev;
        desk_view_t next;
        const char *scaffold =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"},"
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\"}"
            "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"PR #31 flashed\"}}";
        const char *longer =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"},"
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\"}"
            "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"a longer note\"}}";
        const char *quiet_top =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"idle\"},"
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"}"
            "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"PR #31 flashed\"}}";
        const char *jumped =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"running\"},"
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"idle\"}"
            "],\"last_event\":{\"title\":\"Jeeves\",\"message\":\"your turn\"}}";
        const char *needs_only =
            "{\"phase\":\"needs_you\",\"needs_you\":true,\"agents\":["
            "{\"id\":\"jeeves\",\"title\":\"Jeeves\",\"status\":\"needs_you\"},"
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\"}"
            "],\"last_event\":{\"title\":\"Scaffold\",\"message\":\"PR #31 flashed\"}}";
        check(desk_aside_scroll(NULL, NULL) == 0, "scroll needs a view");
        check(desk_view_from_json(scaffold, &next) == 0, "scroll scaffold");
        check(desk_aside_scroll(NULL, &next) == 1, "new top highlight scrolls");
        prev = next;
        check(desk_aside_scroll(&prev, &next) == 0, "same top stays truncated");
        check(desk_view_from_json(longer, &next) == 0, "longer note parse");
        check(desk_aside_scroll(&prev, &next) == 1, "new top message scrolls");
        check(desk_view_from_json(quiet_top, &next) == 0, "quiet top parse");
        check(desk_aside_scroll(NULL, &next) == 0, "lower highlight stays truncated");
        check(desk_aside_scroll(&prev, &next) == 0, "quiet top does not scroll");
        check(desk_view_from_json(scaffold, &prev) == 0, "scaffold was top");
        check(desk_view_from_json(jumped, &next) == 0, "jeeves jumped");
        check(desk_aside_scroll(&prev, &next) == 1, "jump to the top scrolls");
        check(desk_view_from_json(needs_only, &next) == 0, "needs top parse");
        check(desk_aside_scroll(NULL, &next) == 0, "hot top with no aside stays put");
    }

    {
        int name_w = -1;
        int aside_w = -1;
        const char *counted =
            "{\"phase\":\"idle\",\"unread\":4,\"agents\":[],\"last_event\":{\"title\":\"Scaffold\"}}";
        const char *zero = "{\"phase\":\"idle\",\"unread\":0,\"agents\":[]}";
        const char *negative = "{\"phase\":\"idle\",\"unread\":-3,\"agents\":[]}";
        const char *quoted =
            "{\"phase\":\"idle\",\"last_event\":{\"message\":\"see unread: 9\"},\"unread\":2}";
        check(desk_view_from_json(counted, &view) == 0, "unread parse");
        check(view.unread == 4, "unread field");
        check(desk_unread_count(&view) == 4, "unread count");
        check(strcmp(desk_face_title(&view), "Scaffold") == 0, "event title still matches a row");
        check(desk_view_from_json(zero, &view) == 0, "zero unread parse");
        check(desk_unread_count(&view) == 0, "zero is idle");
        check(desk_view_from_json(negative, &view) == 0, "negative unread parse");
        check(desk_unread_count(&view) == 0, "negative is idle");
        check(desk_view_from_json(idle, &view) == 0, "missing unread parse");
        check(view.unread == 0, "missing unread is zero");
        check(desk_unread_count(&view) == 0, "missing unread count");
        check(desk_unread_count(NULL) == 0, "null unread");
        check(desk_view_from_json(quoted, &view) == 0, "quoted unread parse");
        check(desk_unread_count(&view) == 2, "message text is not the count");

        const char *escaped =
            "{\"phase\":\"idle\",\"last_event\":{\"title\":\"Caf\\u00e9\","
            "\"message\":\"hi \\u2014 \\\"ok\\\" \\nnext \\uD83D\\uDE00\"}}";
        check(desk_view_from_json(escaped, &view) == 0, "escaped parse");
        check(strcmp(view.title, "Cafe") == 0, "title folds e-acute");
        check(strcmp(view.message, "hi - \"ok\"  next ") == 0, "dash kept, emoji dropped");
        const char *glyphs =
            "{\"phase\":\"idle\",\"last_event\":{\"message\":\"v1 face-down in Bambu "
            "\\u25B6 click \\u2502 \\uE000\\u2022\\u00B0\"}}";
        const char *raw = "{\"phase\":\"idle\",\"last_event\":{\"message\":\"hi \xf0\x9f\x98\x80 there\"}}";
        check(desk_view_from_json(glyphs, &view) == 0, "glyph parse");
        check(strcmp(view.message, "v1 face-down in Bambu -> click | \xe2\x80\xa2\xc2\xb0") == 0,
              "arrow, box, private-use, bullet, degree");
        check(desk_view_from_json(raw, &view) == 0, "raw utf-8 parse");
        check(strcmp(view.message, "hi  there") == 0, "raw emoji dropped");
        const char *uline = "{\"phase\":\"idle\",\"last_event\":{\"message\":\"a\\u000Ab\"}}";
        check(desk_view_from_json(uline, &view) == 0, "unicode newline parse");
        check(strcmp(view.message, "a b") == 0, "unicode newline becomes a space");

        desk_row_spans(396, 80, 12, 48, 1, &name_w, &aside_w);
        check(name_w == 80, "short name keeps its text width");
        check(aside_w == 304, "aside takes the rest after the gap");
        desk_row_spans(396, 400, 12, 48, 1, &name_w, &aside_w);
        check(name_w == 336, "long name stops at the aside floor");
        check(aside_w == 48, "aside keeps its floor");
        check(name_w + 12 + aside_w == 396, "gap stays between name and aside");
        desk_row_spans(396, 80, 12, 48, 0, &name_w, &aside_w);
        check(name_w == 396 && aside_w == 0, "quiet row gives the name the row");
        desk_row_spans(20, 80, 12, 48, 1, &name_w, &aside_w);
        check(name_w == 0 && aside_w == 8, "tight row keeps the status");
        desk_row_spans(-4, -8, -2, -3, 1, &name_w, &aside_w);
        check(name_w == 0 && aside_w == 0, "negative spans are empty");
        desk_row_spans(396, 80, 12, 48, 1, NULL, NULL);
    }

    {
        desk_view_t plain;
        const char *aside = "x";
        const char *stuck =
            "{\"phase\":\"running\",\"needs_you\":false,\"unread\":2,\"agents\":["
            "{\"id\":\"desky\",\"title\":\"Desky\",\"status\":\"running\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "],\"last_event\":{\"type\":\"note\",\"title\":\"\",\"message\":\"\"}}";
        const char *waiting =
            "{\"phase\":\"needs_you\",\"needs_you\":true,\"unread\":1,\"agents\":["
            "{\"id\":\"desky\",\"title\":\"Desky\",\"status\":\"needs_you\",\"attention\":true,"
            "\"message\":\"roster update\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "],\"last_event\":{\"type\":\"note\",\"agent_id\":\"\",\"title\":\"\",\"message\":\"\"}}";
        const char *bound =
            "{\"phase\":\"needs_you\",\"needs_you\":true,\"agents\":["
            "{\"id\":\"desky\",\"title\":\"Desky\",\"status\":\"needs_you\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "],\"last_event\":{\"type\":\"agent.needs_you\",\"agent_id\":\"desky\","
            "\"title\":\"Roster\",\"message\":\"Spool update\"}}";
        const char *attention_only =
            "{\"phase\":\"running\",\"needs_you\":false,\"agents\":["
            "{\"id\":\"desky\",\"title\":\"Desky\",\"status\":\"running\",\"attention\":true}"
            "]}";
        check(desk_view_from_json(stuck, &view) == 0, "badge only parse");
        check(desk_agent_hot(&view, 0, &aside) == 0, "running desky is not hot");
        check(aside[0] == '\0', "empty note is not an aside");
        check(desk_agent_hot(&view, 1, &aside) == 0, "idle spool is not hot");
        check(desk_view_from_json(waiting, &view) == 0, "waiter parse");
        check(view.needs_you == 1, "waiter raises the alert");
        check(strcmp(desk_phase_label(&view, 0), "NEEDS YOU") == 0, "waiter lamp");
        check(desk_agent_hot(&view, 0, &aside) == 1, "desky is hot");
        check(strcmp(aside, "roster update") == 0, "desky aside is the question");
        check(desk_agent_hot(&view, 1, &aside) == 0, "spool stays quiet");
        plain = view;
        plain.agents[0].message[0] = '\0';
        check(desk_status_same(&view, 0, &plain, 0) == 0, "agent message is a status change");
        plain = view;
        plain.unread = view.unread + 1;
        check(desk_status_same(&view, 0, &plain, 0) == 0, "unread alone is a status change");
        plain = view;
        plain.agents[0].attention = 0;
        check(desk_status_same(&view, 0, &plain, 0) == 0, "attention flag is a status change");
        check(desk_view_from_json(bound, &view) == 0, "bound parse");
        check(strcmp(view.event_agent, "desky") == 0, "event agent id");
        check(desk_agent_hot(&view, 0, &aside) == 1, "id binds the question");
        check(strcmp(aside, "Spool update") == 0, "mismatched title still shows");
        check(desk_agent_hot(&view, 1, &aside) == 0, "spool does not take desky's question");
        check(desk_view_from_json(attention_only, &view) == 0, "attention flag parse");
        check(view.agents[0].attention == 1, "attention field");
        check(view.needs_you == 1, "attention raises the alert");
        check(desk_agent_hot(&view, 0, &aside) == 1, "attention is hot with no message");
        check(aside[0] == '\0', "attention without text has no aside");
        const char *both =
            "{\"phase\":\"needs_you\",\"needs_you\":true,\"agents\":["
            "{\"id\":\"desky\",\"title\":\"Desky\",\"status\":\"needs_you\",\"message\":\"roster update\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"needs_you\",\"message\":\"your turn\"}"
            "],\"last_event\":{\"agent_id\":\"desky\",\"title\":\"Roster\",\"message\":\"roster update\"}}";
        check(desk_view_from_json(both, &view) == 0, "two waiters parse");
        check(desk_agent_hot(&view, 0, &aside) == 1, "desky stays hot");
        check(strcmp(aside, "roster update") == 0, "desky keeps its question");
        check(desk_agent_hot(&view, 1, &aside) == 1, "spool stays hot");
        check(strcmp(aside, "your turn") == 0, "spool is not given desky's question");
    }

    {
        desk_view_t prev;
        desk_view_t next;
        const char *base =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"old wire\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "]}";
        const char *aside_changed =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"new wire\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "]}";
        const char *attention =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"old wire\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"running\",\"attention\":true}"
            "]}";
        const char *born =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"alfred\",\"title\":\"Alfred\",\"status\":\"running\",\"message\":\"up\"},"
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"old wire\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "]}";
        const char *reordered =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"},"
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"old wire\"}"
            "]}";
        const char *recolored =
            "{\"phase\":\"running\",\"agents\":["
            "{\"id\":\"scaffold\",\"title\":\"Scaffold\",\"status\":\"running\",\"message\":\"old wire\","
            "\"color\":\"#3366cc\"},"
            "{\"id\":\"spool\",\"title\":\"Spool\",\"status\":\"idle\"}"
            "]}";
        check(desk_unseen_updates(NULL, NULL) == 0, "unseen needs both views");
        check(desk_view_from_json(base, &prev) == 0, "unseen base");
        check(desk_view_from_json(base, &next) == 0, "unseen same parse");
        check(desk_unseen_updates(&prev, &next) == 0, "same roster is not new");
        check(desk_unseen_updates(NULL, &next) == 0, "missing prev is not new");
        check(desk_view_from_json(aside_changed, &next) == 0, "unseen aside parse");
        check(desk_unseen_updates(&prev, &next) == 1, "changed aside counts once");
        check(desk_view_from_json(attention, &next) == 0, "unseen attention parse");
        check(desk_unseen_updates(&prev, &next) == 1, "status and attention count once");
        check(desk_view_from_json(born, &next) == 0, "unseen new agent parse");
        check(desk_unseen_updates(&prev, &next) == 1, "new agent counts");
        check(desk_view_from_json(reordered, &next) == 0, "unseen reorder parse");
        check(desk_unseen_updates(&prev, &next) == 0, "reorder alone is not new");
        check(desk_view_from_json(recolored, &next) == 0, "unseen recolor parse");
        check(desk_unseen_updates(&prev, &next) == 0, "color alone is not new");
    }

    if (g_failed) {
        return 1;
    }
    printf("PASS\n");
    return 0;
}
