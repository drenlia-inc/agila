import notificationService from '../services/notificationService.js';

export async function publishNotificationQueueUpdated(tenantId = null) {
  try {
    await notificationService.publish(
      'notification-queue-updated',
      { timestamp: new Date().toISOString() },
      tenantId
    );
  } catch (err) {
    console.warn('Failed to publish notification-queue-updated:', err.message);
  }
}
