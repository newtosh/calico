#include "desk_view.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    desk_view_t view;
    const char *sample =
        "{\"phase\":\"running\",\"needs_you\":false,\"agents\":[{\"id\":\"a1\",\"status\":\"running\"}],"
        "\"last_event\":{\"title\":\"Scaffold\",\"message\":\"Pick one\"},\"events\":[]}";
    check(desk_view_from_json(sample, &view) == 0, "sample parse");
    check(strcmp(view.title, "Scaffold") == 0, "title");
    check(strcmp(view.message, "Pick one") == 0, "message");
    check(view.running_count == 1, "running count");
    check(strcmp(desk_phase_label(&view, 0), "RUNNING") == 0, "running label");

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

    const char *idle =
        "{\"phase\":\"idle\",\"needs_you\":false,\"agents\":[],\"last_event\":null,\"events\":[]}";
    check(desk_view_from_json(idle, &view) == 0, "idle parse");
    check(view.title[0] == '\0', "empty title");
    check(strcmp(desk_phase_label(&view, 0), "IDLE") == 0, "idle label");
    check(strcmp(desk_phase_label(&view, 3), "link down") == 0, "link down");
    check(desk_view_from_json(NULL, &view) == -1, "null json");

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

    const char *decoy =
        "{\"phase\":\"idle\",\"last_event\":{\"message\":\"see \\\"panel\\\": "
        "{\\\"url\\\":\\\"http://evil\\\"}\"},\"events\":[]}";
    check(desk_panel_from_json(decoy, &panel) == 0, "decoy parse");
    check(panel.present == 0, "quoted panel is not a push");

    check(desk_panel_from_json(NULL, &panel) == -1, "null panel json");
    check(desk_panel_from_json("{\"panel\":null}", &panel) == 0 && panel.present == 0, "null panel");

    if (g_failed) {
        return 1;
    }
    printf("PASS\n");
    return 0;
}
