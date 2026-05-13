export class PublishQueue {
  private running = false

  async enqueue(jobFn: () => Promise<void>) {
    if (this.running) {
      throw new Error('A publish job is already running')
    }
    this.running = true
    try {
      await jobFn()
    } finally {
      this.running = false
    }
  }

  isRunning() {
    return this.running
  }
}
