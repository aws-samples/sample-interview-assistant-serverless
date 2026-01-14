import { Page } from "@playwright/test";

export class AuthHelper {
  constructor(private page: Page) {}

  /**
   * Handle Cognito direct authentication flow
   * Uses CloudScape Design System components
   */
  async login(email: string, password: string): Promise<void> {
    console.log("🔐 [AuthHelper] Starting authentication flow...");

    // Navigate to home page
    await this.page.goto("/", { waitUntil: "networkidle" });
    console.log("🔐 [AuthHelper] Navigated to home page");

    // Check if already authenticated
    const isAuthenticated = await this.isAuthenticated();
    if (isAuthenticated) {
      console.log("🔐 [AuthHelper] ✅ User already authenticated");
      return;
    }

    console.log("🔐 [AuthHelper] Not authenticated, proceeding with login...");

    // Wait for sign-in form to be visible
    await this.page.waitForSelector('input[placeholder*="email" i]', {
      timeout: 10000,
    });
    console.log("🔐 [AuthHelper] Sign-in form visible");

    // Fill in email field (CloudScape Input component)
    const emailInput = this.page.locator('input[placeholder*="email" i]');
    await emailInput.fill(email);
    console.log(`🔐 [AuthHelper] Filled email: ${email}`);

    // Fill in password field (CloudScape Input component)
    const passwordInput = this.page.locator('input[type="password"]');
    await passwordInput.fill(password);
    console.log("🔐 [AuthHelper] Filled password");

    // Click the "Sign In" button
    const signInButton = this.page.getByRole("button", { name: /sign in/i });
    await signInButton.click();
    console.log("🔐 [AuthHelper] Clicked Sign In button");

    // Wait for authentication to complete
    // After successful login, app redirects to "/" and shows dashboard
    await this.page.waitForURL("/", { timeout: 30000 });
    console.log("🔐 [AuthHelper] Redirected to home page");

    // Wait for sign-in form to disappear (authentication successful)
    await this.page.waitForSelector('input[placeholder*="email" i]', {
      state: "hidden",
      timeout: 10000,
    });
    console.log("🔐 [AuthHelper] Sign-in form hidden");

    // Verify authToken is stored in localStorage
    const authToken = await this.page.evaluate(() =>
      localStorage.getItem("authToken"),
    );
    if (authToken) {
      console.log("🔐 [AuthHelper] ✅ Auth token found in localStorage");
    } else {
      console.warn("🔐 [AuthHelper] ⚠️ Auth token not found in localStorage");
    }

    // Final verification: check for dashboard or navigation elements
    const isDashboardVisible =
      (await this.page
        .getByRole("heading", { name: /dashboard/i })
        .isVisible({ timeout: 5000 })
        .catch(() => false)) ||
      (await this.page
        .getByRole("link", { name: /prepare interview/i })
        .isVisible({ timeout: 5000 })
        .catch(() => false));

    if (isDashboardVisible) {
      console.log(
        "🔐 [AuthHelper] ✅ Authentication successful - dashboard visible",
      );
    } else {
      console.warn(
        "🔐 [AuthHelper] ⚠️ Dashboard not visible, but auth may have succeeded",
      );
    }
  }

  /**
   * Check if user is authenticated
   * Looks for absence of sign-in form and presence of auth token or dashboard elements
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      // First check: Is sign-in form visible?
      const signInFormVisible = await this.page
        .locator('input[placeholder*="email" i]')
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (signInFormVisible) {
        console.log(
          "🔐 [AuthHelper] Sign-in form is visible - not authenticated",
        );
        return false;
      }

      // Second check: Is dashboard/navigation visible?
      const hasDashboardElements = await this.page
        .getByRole("link", { name: /prepare interview|schedule interview/i })
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasDashboardElements) {
        console.log(
          "🔐 [AuthHelper] Dashboard elements visible - authenticated",
        );
        return true;
      }

      // Third check: Auth token in localStorage (might take time to write)
      const authToken = await this.page.evaluate(() =>
        localStorage.getItem("authToken"),
      );

      if (authToken) {
        console.log(
          "🔐 [AuthHelper] Auth token exists and sign-in form is hidden - authenticated",
        );
        return true;
      }

      console.log("🔐 [AuthHelper] No auth token in localStorage");
      return false;
    } catch (error) {
      console.log("🔐 [AuthHelper] Error checking authentication:", error);
      return false;
    }
  }

  /**
   * Logout the user
   */
  async logout(): Promise<void> {
    console.log("🔐 [AuthHelper] Attempting to logout...");

    // Look for sign out button in TopNavigation
    const signOutButton = this.page.getByRole("button", {
      name: /sign out|logout/i,
    });

    if (await signOutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signOutButton.click();
      console.log("🔐 [AuthHelper] Clicked sign out button");

      // Wait for auth token to be cleared
      await this.page.waitForFunction(
        () => !localStorage.getItem("authToken"),
        { timeout: 5000 },
      );
      console.log("🔐 [AuthHelper] ✅ Logout successful");
    } else {
      console.warn("🔐 [AuthHelper] Sign out button not found");
    }
  }

  /**
   * Get user email from localStorage auth token
   */
  async getUserId(): Promise<string | null> {
    try {
      const userEmail = await this.page.evaluate(() => {
        const token = localStorage.getItem("authToken");
        if (!token) return null;

        // Parse JWT token to extract email
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          return payload.email || payload["cognito:username"] || null;
        } catch {
          return null;
        }
      });

      if (userEmail) {
        console.log(`🔐 [AuthHelper] User email: ${userEmail}`);
      }

      return userEmail;
    } catch (error) {
      console.log("🔐 [AuthHelper] Error getting user ID:", error);
      return null;
    }
  }
}
