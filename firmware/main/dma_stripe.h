#pragma once

/* One RGB565 stripe in internal DMA RAM.
 *
 * ae7c93e (#39) logged, then went silent:
 *   DMA draw buffer 48000 bytes x2 (50 lines), largest internal 29696
 * NVS still held the saved SSIDs. No scan, no "joining", no GOT_IP, and
 * no printed ESP_ERR_NO_MEM. wifi_bringup runs after that pin and needs
 * a contiguous INTERNAL|DMA block. 29696 was not enough, so the STA never
 * started.
 *
 * Those two 48000 allocations both succeeded, so each was a contiguous
 * DMA region. This pin takes one 19200-byte stripe and leaves the other
 * 48000 region untouched. 48000 is the floor for the largest free block
 * after the pin, well above 29696. The stripe is still internal DMA, so
 * the SPI driver does not bounce a PSRAM copy. Even height matches the
 * CO5300 window. */
enum {
    DESK_DMA_LINES = 20,
    DESK_DMA_BUFS = 1,
    DESK_DMA_WIDTH = 480,
    DESK_DMA_BPP = 2,
    /* largest internal DMA block after the 2×50-line pin. STA died here. */
    DESK_DMA_LEFT_AFTER_PAIR = 29696,
    /* One of the two regions #39 allocated. Left free on purpose. */
    DESK_DMA_KEPT_FOR_STA = 50 * 480 * 2,
    DESK_DMA_BYTES = DESK_DMA_WIDTH * DESK_DMA_LINES * DESK_DMA_BPP
};
