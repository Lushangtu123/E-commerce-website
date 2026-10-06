import { userApi } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Ends the customer session in every tab at once, then asks the API to clear the httpOnly cookie,
 * which the page itself cannot remove. A failed request still leaves the browser signed out here.
 */
export async function signOut(): Promise<void> {
  useAuthStore.getState().logout();
  try {
    await userApi.logout();
  } catch (error) {
    logger.error('退出登录失败:', error);
  }
}
