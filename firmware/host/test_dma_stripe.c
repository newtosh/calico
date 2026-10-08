#include "dma_stripe.h"

#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    enum { PAIR_BYTES = 2 * DESK_DMA_KEPT_FOR_STA };
    check(DESK_DMA_BUFS == 1, "one buffer; the second stripe stays with Wi-Fi");
    check(DESK_DMA_LINES == 20, "20-line stripe");
    check(DESK_DMA_BYTES == 19200, "pin is 19200 bytes");
    check(DESK_DMA_BYTES < DESK_DMA_KEPT_FOR_STA, "do not consume a 50-line region");
    check(DESK_DMA_KEPT_FOR_STA > DESK_DMA_LEFT_AFTER_PAIR, "kept region is above the 29696 that starved STA");
    check(PAIR_BYTES == 96000, "the pin that starved STA");
    check((DESK_DMA_LINES % 2) == 0, "even height for a CO5300 window");
    check((DESK_DMA_BYTES % 64) == 0, "multiple of the cache line");
    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
