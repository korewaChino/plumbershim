// WebSocket handler for sending input events to plumbershim
class WebSocketHandler {
  // todo: don't hardcode the ip
  constructor(url = "ws://192.168.1.34:8000") {
    this.url = url;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1 second
    this.connect();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        console.log("🟢 Connected to plumbershim WebSocket");
        this.isConnected = true;
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        console.log("📥 Received from plumbershim:", event.data);
      };

      this.ws.onclose = (event) => {
        console.log("🔴 WebSocket connection closed");
        this.isConnected = false;
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
        this.isConnected = false;
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      this.attemptReconnect();
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error("Max reconnection attempts reached. Please refresh the page.");
    }
  }

  sendInputEvent(deviceId, events) {
    if (!this.isConnected || !this.ws) {
      console.warn("WebSocket not connected. Cannot send event.");
      return false;
    }

    const packet = {
      device_id: deviceId,
      timestamp: Date.now(),
      events: events
    };

    try {
      this.ws.send(JSON.stringify(packet));
      console.log("📤 Sent input packet:", packet);
      return true;
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
      return false;
    }
  }

  sendKeyboardEvent(key, pressed, deviceId = "chunitroller-webapp") {
    const eventType = pressed ? "KeyPress" : "KeyRelease";
    const events = [{
      "Keyboard": {
        [eventType]: {
          "key": key
        }
      }
    }];

    return this.sendInputEvent(deviceId, events);
  }

  sendPointerEvent(eventType, data, deviceId = "chunitroller-webapp") {
    const events = [{
      "Pointer": {
        [eventType]: data
      }
    }];

    return this.sendInputEvent(deviceId, events);
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }
}

// Enhanced cell feedback handler with improved performance
class CellFeedbackHandler {
  constructor() {
    this.activeCells = new Set();
  }

  activateCell(cell) {
    if (!this.activeCells.has(cell)) {
      console.log("🟢 Activating cell:", cell.getAttribute('data-key'));
      cell.classList.add('active');
      this.activeCells.add(cell);
    }
  }

  deactivateCell(cell) {
    if (this.activeCells.has(cell)) {
      console.log("🔴 Deactivating cell:", cell.getAttribute('data-key'));
      cell.classList.remove('active');
      this.activeCells.delete(cell);
    }
  }

  resetAll() {
    this.activeCells.forEach((cell) => {
      cell.classList.remove('active');
    });
    this.activeCells.clear();
  }

  // Get count of currently active cells
  getActiveCount() {
    return this.activeCells.size;
  }

  // Check if a specific cell is active
  isCellActive(cell) {
    return this.activeCells.has(cell);
  }
}
class GridController {
  constructor() {
    this.feedbackHandler = new CellFeedbackHandler();
    this.webSocketHandler = new WebSocketHandler();
    this.cells = [];
    this.activeTouches = new Map(); // touchId -> {cell, index, startTime}
    this.cellTouchCounts = new Map(); // cellIndex -> number of active touches (for keyboard events)
    this.cellVisualTouches = new Map(); // cellIndex -> Set of touch IDs (for visual feedback)
    this.touchCounter = null; // Will be set in init
    this.init();
  }

  init() {
    this.cells = document.querySelectorAll(".grid-cell");
    this.touchCounter = document.getElementById("touchCounter");
    this.cells.forEach((cell, index) => {
      cell.setAttribute('data-cell-index', index);
      this.cellTouchCounts.set(index, 0);
      this.cellVisualTouches.set(index, new Set());
    });
    this.setupGlobalTouchHandlers();
    this.updateTouchCounter();

    console.log(`Grid controller initialized with ${this.cells.length} cells`);
  }

  setupCellHandlers(cell, index) {
    // Remove individual cell touch handlers - we'll handle everything globally
    // This ensures proper multitouch support across the entire grid
  }

  setupGlobalTouchHandlers() {
    // Add mouse support for testing - this should work in Safari
    document.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("grid-cell")) {
        console.log("🖱️ Mouse down on cell:", e.target.getAttribute('data-key'));
        e.preventDefault();
        const cellIndex = parseInt(e.target.getAttribute('data-cell-index'));
        if (cellIndex !== null && !isNaN(cellIndex)) {
          // Simulate touch data for mouse
          this.activeTouches.set('mouse', {
            cell: e.target,
            index: cellIndex,
            startTime: Date.now()
          });
          
          const currentCount = this.cellTouchCounts.get(cellIndex) || 0;
          this.cellTouchCounts.set(cellIndex, currentCount + 1);
          
          // Always activate visual feedback
          this.feedbackHandler.activateCell(e.target);
          
          // Only send keyboard event if this is the first touch on this cell
          if (currentCount === 0) {
            const key = this.mapCellToKey(e.target);
            const deviceName = this.getDeviceNameForCell(e.target);
            this.webSocketHandler.sendKeyboardEvent(key, true, deviceName);
            
            e.target.dispatchEvent(
              new CustomEvent("cellpress", {
                detail: { index: cellIndex, cell: e.target, key },
                bubbles: true,
              }),
            );
          }
          
          this.updateTouchCounter();
        }
      }
    });

    document.addEventListener("mouseup", (e) => {
      if (this.activeTouches.has('mouse')) {
        console.log("🖱️ Mouse up");
        this.handleTouchEnd({ identifier: 'mouse' }, "mouse_up");
        this.updateTouchCounter();
      }
    });

    // Handle touch start events globally to ensure proper multitouch support
    document.addEventListener("touchstart", (e) => {
      console.log("👆 Touch start detected, touches:", e.changedTouches.length);
      e.preventDefault();
      Array.from(e.changedTouches).forEach((touch) => {
        const elementUnderTouch = document.elementFromPoint(
          touch.clientX,
          touch.clientY
        );
        
        console.log("👆 Element under touch:", elementUnderTouch?.tagName, elementUnderTouch?.getAttribute('data-key'));
        
        if (elementUnderTouch && elementUnderTouch.classList.contains("grid-cell")) {
          const cellIndex = parseInt(elementUnderTouch.getAttribute('data-cell-index'));
          console.log("👆 Touch on grid cell, index:", cellIndex);
          if (cellIndex !== null && !isNaN(cellIndex)) {
            // Track this touch
            this.activeTouches.set(touch.identifier, {
              cell: elementUnderTouch,
              index: cellIndex,
              startTime: Date.now()
            });
            
            // Increment touch count for this cell (for keyboard events)
            const currentCount = this.cellTouchCounts.get(cellIndex) || 0;
            this.cellTouchCounts.set(cellIndex, currentCount + 1);
            
            // Add this touch to visual tracking for this cell
            const visualTouches = this.cellVisualTouches.get(cellIndex);
            visualTouches.add(touch.identifier);
            
            // Always activate visual feedback for any touch
            this.feedbackHandler.activateCell(elementUnderTouch);
            
            // Only send keyboard press event if this is the first touch on this cell
            if (currentCount === 0) {
              console.log("👆 First touch on cell, sending keyboard event");
              const key = this.mapCellToKey(elementUnderTouch);
              const deviceName = this.getDeviceNameForCell(elementUnderTouch);
              this.webSocketHandler.sendKeyboardEvent(key, true, deviceName);
              
              elementUnderTouch.dispatchEvent(
                new CustomEvent("cellpress", {
                  detail: { index: cellIndex, cell: elementUnderTouch, key },
                  bubbles: true,
                }),
              );
            }
            
            this.updateTouchCounter();
          }
        }
      });
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
      if (this.activeTouches.size > 0) {
        e.preventDefault();
        this.handleTouchMove(e);
      }
    }, { passive: false });

    document.addEventListener("touchend", (e) => {
      Array.from(e.changedTouches).forEach((touch) => {
        this.handleTouchEnd(touch);
      });
      this.updateTouchCounter();
    }, { passive: false });

    document.addEventListener("touchcancel", (e) => {
      Array.from(e.changedTouches).forEach((touch) => {
        this.handleTouchEnd(touch, "touch_cancel");
      });
      this.updateTouchCounter();
    }, { passive: false });
  }

  handleTouchEnd(touch, reason = "touch_end") {
    const touchData = this.activeTouches.get(touch.identifier);
    if (touchData) {
      const cellIndex = touchData.index;
      
      console.log("🔴 Touch end - cellIndex:", cellIndex, "reason:", reason);
      
      // Remove this touch from visual tracking
      const visualTouches = this.cellVisualTouches.get(cellIndex);
      if (visualTouches) {
        visualTouches.delete(touch.identifier);
        
        // Only deactivate visual feedback if no touches remain on this cell
        if (visualTouches.size === 0) {
          console.log("🔴 Last visual touch on cell, deactivating visual feedback");
          this.feedbackHandler.deactivateCell(touchData.cell);
        }
      }
      
      // Decrement touch count for keyboard events
      const currentCount = this.cellTouchCounts.get(cellIndex) || 1;
      const newCount = Math.max(0, currentCount - 1);
      this.cellTouchCounts.set(cellIndex, newCount);
      
      console.log("🔴 Touch counts - was:", currentCount, "now:", newCount);
      
      // Only send keyboard release if this was the last touch on this cell
      if (newCount === 0) {
        console.log("🔴 Last keyboard touch on cell, sending keyboard release");
        
        // Send keyboard release event
        const key = this.mapCellToKey(touchData.cell);
        const deviceName = this.getDeviceNameForCell(touchData.cell);
        this.webSocketHandler.sendKeyboardEvent(key, false, deviceName);
        
        touchData.cell.dispatchEvent(
          new CustomEvent("cellrelease", {
            detail: {
              index: touchData.index,
              cell: touchData.cell,
              key: key,
              reason: reason,
            },
            bubbles: true,
          }),
        );
      } else {
        console.log("🔴 Still", newCount, "keyboard touches on cell, keeping keyboard pressed");
      }
      
      // Always remove the touch from active touches
      this.activeTouches.delete(touch.identifier);
    } else {
      console.log("🔴 Touch end but no touch data found for:", touch.identifier);
    }
  }

  handleCellPress(cell, index) {
    console.log("🎯 handleCellPress called for cell:", cell.getAttribute('data-key'), "index:", index);
    
    // This method is now mainly for legacy compatibility
    // The actual logic is handled directly in touch/mouse event handlers
    this.feedbackHandler.activateCell(cell);
    
    // Send keyboard event for cell press
    const key = this.mapCellToKey(cell);
    const deviceName = this.getDeviceNameForCell(cell);
    this.webSocketHandler.sendKeyboardEvent(key, true, deviceName);
    
    cell.dispatchEvent(
      new CustomEvent("cellpress", {
        detail: { index, cell, key },
        bubbles: true,
      }),
    );
  }

  // Map cell to keyboard key using data-key attribute
  mapCellToKey(cellOrIndex) {
    let cell;
    if (typeof cellOrIndex === 'number') {
      // If given an index, get the cell element
      cell = this.cells[cellOrIndex];
    } else {
      // If given a cell element directly
      cell = cellOrIndex;
    }
    
    if (!cell) {
      console.warn("Could not find cell for mapping");
      return "KEY_UNKNOWN";
    }

    const dataKey = cell.getAttribute('data-key');
    if (!dataKey) {
      console.warn("Cell has no data-key attribute:", cell);
      return "KEY_UNKNOWN";
    }

    // Convert the data-key to Linux key code format
    return this.convertToLinuxKeyCode(dataKey);
  }

  // Update the touch counter display
  updateTouchCounter() {
    if (this.touchCounter) {
      const activeCount = this.activeTouches.size;
      const activeCellCount = this.feedbackHandler.getActiveCount();
      this.touchCounter.textContent = `Touches: ${activeCount} | Cells: ${activeCellCount}`;
    }
  }

  // Get debug information about current touch state
  getTouchDebugInfo() {
    return {
      activeTouches: this.activeTouches.size,
      touchData: Array.from(this.activeTouches.entries()).map(([id, data]) => ({
        touchId: id,
        cellIndex: data.index,
        startTime: data.startTime,
        duration: Date.now() - data.startTime
      })),
      cellTouchCounts: Array.from(this.cellTouchCounts.entries())
        .filter(([_, count]) => count > 0)
        .map(([index, count]) => ({ cellIndex: index, touchCount: count }))
    };
  }

  // Reset all touch state (useful for debugging)
  resetTouchState() {
    this.activeTouches.clear();
    this.cellTouchCounts.forEach((_, index) => {
      this.cellTouchCounts.set(index, 0);
    });
    this.cellVisualTouches.forEach((touchSet, index) => {
      touchSet.clear();
    });
    this.feedbackHandler.resetAll();
    this.updateTouchCounter();
    console.log("Touch state reset");
  }

  // Convert data-key attribute to Linux key code format
  convertToLinuxKeyCode(dataKey) {
    // Handle special cases first
    const specialKeys = {
      'Backspace': 'KEY_BACKSPACE',
      'Tab': 'KEY_TAB',
      'Enter': 'KEY_ENTER',
      'CapsLock': 'KEY_CAPSLOCK',
      'ShiftLeft': 'KEY_LEFTSHIFT',
      'ShiftRight': 'KEY_RIGHTSHIFT',
      'ControlLeft': 'KEY_LEFTCTRL',
      'ControlRight': 'KEY_RIGHTCTRL',
      'AltLeft': 'KEY_LEFTALT',
      'AltRight': 'KEY_RIGHTALT',
      ' ': 'KEY_SPACE',
      '`': 'KEY_GRAVE',
      '-': 'KEY_MINUS',
      '=': 'KEY_EQUAL',
      '[': 'KEY_LEFTBRACE',
      ']': 'KEY_RIGHTBRACE',
      '\\': 'KEY_BACKSLASH',
      ';': 'KEY_SEMICOLON',
      "'": 'KEY_APOSTROPHE',
      ',': 'KEY_COMMA',
      '.': 'KEY_DOT',
      '/': 'KEY_SLASH'
    };

    if (specialKeys[dataKey]) {
      return specialKeys[dataKey];
    }

    // Handle numbers 0-9
    if (/^[0-9]$/.test(dataKey)) {
      return `KEY_${dataKey}`;
    }

    // Handle letters a-z (convert to uppercase for key codes)
    if (/^[a-zA-Z]$/.test(dataKey)) {
      return `KEY_${dataKey.toUpperCase()}`;
    }

    // If we don't recognize it, return as-is with KEY_ prefix
    console.warn("Unknown key mapping for:", dataKey);
    return `KEY_${dataKey.toUpperCase()}`;
  }

  // Get device name based on cell's section
  getDeviceNameForCell(cell) {
    // Find the parent container with data-cell-section
    let container = cell.closest('[data-cell-section]');
    if (container) {
      const section = container.getAttribute('data-cell-section');
      return `chunitroller-${section}`;
    }
    
    // Fallback to generic name
    return "chunitroller-webapp";
  }

  handleTouchMove(e) {
    Array.from(e.touches).forEach((touch) => {
      const touchData = this.activeTouches.get(touch.identifier);
      if (!touchData) return;

      const elementUnderTouch = document.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );

      if (
        elementUnderTouch &&
        elementUnderTouch.classList.contains("grid-cell")
      ) {
        const newCellIndex = parseInt(elementUnderTouch.getAttribute('data-cell-index'));
        if (newCellIndex !== null && !isNaN(newCellIndex) && newCellIndex !== touchData.index) {
          // Moving to a different cell
          const oldCellIndex = touchData.index;
          
          console.log("🔄 Touch sliding from cell", oldCellIndex, "to cell", newCellIndex);
          
          // Remove this touch from old cell's visual tracking
          const oldVisualTouches = this.cellVisualTouches.get(oldCellIndex);
          if (oldVisualTouches) {
            oldVisualTouches.delete(touch.identifier);
            // Only deactivate visual feedback if no visual touches remain on old cell
            if (oldVisualTouches.size === 0) {
              this.feedbackHandler.deactivateCell(touchData.cell);
            }
          }
          
          // Decrement keyboard touch count for old cell
          const oldCount = this.cellTouchCounts.get(oldCellIndex) || 1;
          const newOldCount = Math.max(0, oldCount - 1);
          this.cellTouchCounts.set(oldCellIndex, newOldCount);
          
          // Only send keyboard release if this was the last keyboard touch on old cell
          if (newOldCount === 0) {
            const oldKey = this.mapCellToKey(touchData.cell);
            const oldDeviceName = this.getDeviceNameForCell(touchData.cell);
            this.webSocketHandler.sendKeyboardEvent(oldKey, false, oldDeviceName);
            
            touchData.cell.dispatchEvent(
              new CustomEvent("cellrelease", {
                detail: {
                  index: touchData.index,
                  cell: touchData.cell,
                  key: oldKey,
                  reason: "slid_away",
                },
                bubbles: true,
              }),
            );
          }
          
          // Add this touch to new cell's visual tracking
          const newVisualTouches = this.cellVisualTouches.get(newCellIndex);
          if (newVisualTouches) {
            newVisualTouches.add(touch.identifier);
          }
          
          // Increment keyboard touch count for new cell
          const newCount = this.cellTouchCounts.get(newCellIndex) || 0;
          this.cellTouchCounts.set(newCellIndex, newCount + 1);
          
          // Update touch data
          this.activeTouches.set(touch.identifier, {
            cell: elementUnderTouch,
            index: newCellIndex,
            startTime: touchData.startTime
          });
          
          // Always activate visual feedback for the new cell
          this.feedbackHandler.activateCell(elementUnderTouch);
          
          // Only send keyboard event if this is the first keyboard touch on the new cell
          if (newCount === 0) {
            const key = this.mapCellToKey(elementUnderTouch);
            const deviceName = this.getDeviceNameForCell(elementUnderTouch);
            this.webSocketHandler.sendKeyboardEvent(key, true, deviceName);
            
            elementUnderTouch.dispatchEvent(
              new CustomEvent("cellpress", {
                detail: { index: newCellIndex, cell: elementUnderTouch, key },
                bubbles: true,
              }),
            );
          }
        }
      } else {
        // Moved outside the grid - treat as touch end
        this.handleTouchEnd(touch, "moved_outside");
      }
    });
  }

  getCell(index) {
    return this.cells[index] || null;
  }

  getCellCount() {
    return this.cells.length;
  }

  setFeedbackHandler(newHandler) {
    this.feedbackHandler.resetAll();
    this.feedbackHandler = newHandler;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.gridController = new GridController();
  
  // Expose debug methods globally for console access
  window.debugTouch = () => {
    console.log("Touch Debug Info:", window.gridController.getTouchDebugInfo());
  };
  
  window.resetTouch = () => {
    window.gridController.resetTouchState();
  };
  
  // Test function to manually activate a cell
  window.testCell = (key) => {
    const cell = document.querySelector(`[data-key="${key}"]`);
    if (cell) {
      console.log("🧪 Testing cell activation for key:", key);
      cell.classList.add('active');
      setTimeout(() => {
        cell.classList.remove('active');
        console.log("🧪 Test complete");
      }, 1000);
    } else {
      console.log("🧪 Cell not found for key:", key);
    }
  };
  
  console.log("🎮 Chunithm Controller loaded with improved multitouch support");
  console.log("🔧 Debug commands: debugTouch(), resetTouch(), testCell('q')");
});

document.addEventListener("cellpress", (e) => {
  const touchInfo = window.gridController?.getTouchDebugInfo();
  console.log(`🟢 Cell ${e.detail.index} pressed -> Key: ${e.detail.key} (Active touches: ${touchInfo?.activeTouches || 0})`);
});

document.addEventListener("cellrelease", (e) => {
  const touchInfo = window.gridController?.getTouchDebugInfo();
  let reasonText = "";
  if (e.detail.reason === "slid_away") {
    reasonText = " (slid away)";
  } else if (e.detail.reason === "moved_outside") {
    reasonText = " (moved outside grid)";
  } else if (e.detail.reason === "touch_cancel") {
    reasonText = " (touch cancelled)";
  }
  console.log(`🔴 Cell ${e.detail.index} released${reasonText} -> Key: ${e.detail.key} (Active touches: ${touchInfo?.activeTouches || 0})`);
});

document.addEventListener("contextmenu", (e) => {
  if (e.target.classList.contains("grid-cell")) {
    e.preventDefault();
  }
});
