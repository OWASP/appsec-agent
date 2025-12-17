/**
 * Blinking cursor utility for showing processing status
 * 
 * Author: Sam Li
 */

/**
 * Blinking cursor utility for showing processing status
 * Displays a blinking indicator while waiting for responses
 */
export class BlinkingCursor {
  private intervalId: NodeJS.Timeout | null = null;
  private isVisible: boolean = true;
  private readonly cursorChar = '▋';
  private readonly blinkInterval = 500; // milliseconds

  /**
   * Start the blinking cursor animation
   * Only works in TTY (terminal) environments
   */
  start(): void {
    // Only start if stdout is a TTY (terminal)
    if (!process.stdout.isTTY) {
      return;
    }

    // Hide cursor initially
    process.stdout.write('\x1b[?25l'); // Hide cursor
    
    this.intervalId = setInterval(() => {
      if (this.isVisible) {
        process.stdout.write(`\rClaude is thinking ... ${this.cursorChar}`);
        this.isVisible = false;
      } else {
        process.stdout.write(`\rClaude is thinking ...  `);
        this.isVisible = true;
      }
    }, this.blinkInterval);
  }

  /**
   * Stop the blinking cursor animation and restore normal cursor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Clear the line and restore cursor
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('\x1b[?25h'); // Show cursor
    }
  }
}

