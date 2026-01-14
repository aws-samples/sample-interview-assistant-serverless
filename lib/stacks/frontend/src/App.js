import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  AppLayout,
  TopNavigation,
  SideNavigation,
  Flashbar,
  BreadcrumbGroup,
} from "@cloudscape-design/components";

// Pages - Candidate View
import Dashboard from "./pages/Dashboard";
import PrepareInterviewList from "./pages/PrepareInterviewList";
import PrepareInterviewNew from "./pages/PrepareInterviewNew";
import PrepareInterviewDetail from "./pages/PrepareInterviewDetail";
import LivePractice from "./pages/LivePractice";
import LivePracticeNew from "./pages/LivePracticeNew";
import LivePracticeSession from "./pages/LivePracticeSession";
import PracticeSessionDetail from "./pages/PracticeSessionDetail";
import PracticeWizard from "./pages/PracticeWizard";
import SessionHistory from "./pages/SessionHistory";
import LiveAssistant from "./pages/LiveAssistant";
import CandidateSessionList from "./pages/CandidateSessionList";
import CandidateSessionDetail from "./pages/CandidateSessionDetail";
import Settings from "./pages/Settings";

// Pages - Interviewer
import InterviewerList from "./pages/InterviewerList";
import InterviewerNew from "./pages/InterviewerNew";
import InterviewerDetail from "./pages/InterviewerDetail";
import InterviewerLive from "./pages/InterviewerLive";
import InterviewerSessionList from "./pages/InterviewerSessionList";
import InterviewerSessionDetail from "./pages/InterviewerSessionDetail";

// Authentication
import { CustomSignIn } from "./pages/CustomAuthComponents";

import { Amplify } from "aws-amplify";
// Configuration
import amplifyConfig from "./config/amplify-config";
// Configure Amplify
Amplify.configure(amplifyConfig);

// Check if NO_AUTH mode is enabled
const NO_AUTH = process.env.REACT_APP_NO_AUTH === "true";

// Customer branding from environment variables
const CUSTOMER_NAME = process.env.REACT_APP_CUSTOMER_NAME || "AnyCompany";
const CUSTOMER_LOGO =
  process.env.REACT_APP_CUSTOMER_LOGO || "/interview_logo.png";

function AppContent({ signOut, user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeNavItem, setActiveNavItem] = useState("/");

  // Socket.IO removed in serverless migration
  // - S2S audio uses native WebSocket (s2sWebSocketService)
  // - Real-time notifications use REST API polling (planAPI.pollCandidatePlanUntilComplete / planAPI.pollInterviewerPlanUntilComplete)

  useEffect(() => {
    setActiveNavItem(location.pathname);
  }, [location]);

  const addNotification = (notification) => {
    setNotifications((prev) => [...prev, notification]);
  };

  const removeNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const getBreadcrumbs = () => {
    // Handle dynamic routes
    if (location.pathname.startsWith("/practice/session/")) {
      // Check if it's a detail view
      if (location.pathname.includes("/view")) {
        return [
          { text: "Dashboard", href: "/" },
          { text: "Live Practice Sessions", href: "/practice" },
          { text: "Session Details", href: location.pathname },
        ];
      }
      return [
        { text: "Dashboard", href: "/" },
        { text: "Live Practice Sessions", href: "/practice" },
        { text: "Practice Session", href: location.pathname },
      ];
    }

    // Handle interviewer session detail routes
    if (location.pathname.startsWith("/interviewer/sessions/")) {
      return [
        { text: "Dashboard", href: "/" },
        { text: "Interview Sessions", href: "/interviewer/sessions" },
        { text: "Session Details", href: location.pathname },
      ];
    }

    // Handle candidate session detail routes
    if (
      location.pathname.startsWith("/candidate/sessions/") &&
      location.pathname !== "/candidate/sessions"
    ) {
      return [
        { text: "Dashboard", href: "/" },
        { text: "Interview Sessions", href: "/candidate/sessions" },
        { text: "Session Details", href: location.pathname },
      ];
    }

    // Handle interviewer detail routes
    if (
      location.pathname.startsWith("/interviewer/") &&
      location.pathname !== "/interviewer/create" &&
      location.pathname !== "/interviewer/new" &&
      location.pathname !== "/interviewer/live" &&
      location.pathname !== "/interviewer/sessions"
    ) {
      return [
        { text: "Dashboard", href: "/" },
        { text: "Schedule Interview", href: "/interviewer/create" },
        { text: "Interview Details", href: location.pathname },
      ];
    }

    const pathMap = {
      "/": [{ text: "Dashboard", href: "/" }],
      "/prepare": [
        { text: "Dashboard", href: "/" },
        { text: "Prepare Interview", href: "/prepare" },
      ],
      "/prepare/new": [
        { text: "Dashboard", href: "/" },
        { text: "Prepare Interview", href: "/prepare" },
        { text: "New Preparation", href: "/prepare/new" },
      ],
      "/practice": [
        { text: "Dashboard", href: "/" },
        { text: "Live Practice Sessions", href: "/practice" },
      ],
      "/practice/new": [
        { text: "Dashboard", href: "/" },
        { text: "Live Practice Sessions", href: "/practice" },
        { text: "Select Preparation", href: "/practice/new" },
      ],
      "/practice/wizard": [
        { text: "Dashboard", href: "/" },
        { text: "Live Practice Sessions", href: "/practice" },
        { text: "Practice Wizard", href: "/practice/wizard" },
      ],
      "/assistant": [
        { text: "Dashboard", href: "/" },
        { text: "Live Assistant", href: "/assistant" },
      ],
      "/history": [
        { text: "Dashboard", href: "/" },
        { text: "Session History", href: "/history" },
      ],
      "/candidate/live-assistant": [
        { text: "Dashboard", href: "/" },
        { text: "Live Assistant", href: "/candidate/live-assistant" },
      ],
      "/candidate/sessions": [
        { text: "Dashboard", href: "/" },
        { text: "Interview Sessions", href: "/candidate/sessions" },
      ],
      "/interviewer/create": [
        { text: "Dashboard", href: "/" },
        { text: "Schedule Interview", href: "/interviewer/create" },
      ],
      "/interviewer/new": [
        { text: "Dashboard", href: "/" },
        { text: "Schedule Interview", href: "/interviewer/create" },
        { text: "New Interview", href: "/interviewer/new" },
      ],
      "/interviewer/live": [
        { text: "Dashboard", href: "/" },
        { text: "Schedule Interview", href: "/interviewer/create" },
        { text: "Live Assistant", href: "/interviewer/live" },
      ],
      "/interviewer/sessions": [
        { text: "Dashboard", href: "/" },
        { text: "Interview Sessions", href: "/interviewer/sessions" },
      ],
      "/settings": [
        { text: "Dashboard", href: "/" },
        { text: "Settings", href: "/settings" },
      ],
    };

    return pathMap[location.pathname] || [{ text: "Dashboard", href: "/" }];
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopNavigation
        identity={{
          href: "/",
          title: `${CUSTOMER_NAME} AI Interview Assistant`,
          logo: {
            src: CUSTOMER_LOGO,
            alt: `${CUSTOMER_NAME} Logo`,
          },
        }}
        utilities={[
          // Connection status removed - S2S uses native WebSocket per session
          // {
          //   type: 'button',
          //   text: wsConnected ? 'Connected' : 'Disconnected',
          //   iconName: wsConnected ? 'status-positive' : 'status-warning',
          //   variant: wsConnected ? 'normal' : 'link',
          // },
          {
            type: "menu-dropdown",
            text: user?.email || user?.username || "User",
            description: user?.email || "Authenticated User",
            iconName: "user-profile",
            items: [
              {
                id: "signout",
                text: "Sign out",
              },
            ],
            onItemClick: ({ detail }) => {
              if (detail.id === "signout" && signOut) {
                signOut();
              }
            },
          },
        ]}
      />

      <AppLayout
        navigation={
          <SideNavigation
            activeHref={activeNavItem}
            header={{ text: "Navigation", href: "/" }}
            onFollow={(event) => {
              if (!event.detail.external) {
                event.preventDefault();
                navigate(event.detail.href);
              }
            }}
            items={[
              { type: "link", text: "Dashboard", href: "/" },
              { type: "divider" },
              {
                type: "section",
                text: "Candidate View",
                items: [
                  { type: "link", text: "Prepare Interview", href: "/prepare" },
                  {
                    type: "link",
                    text: "Live Practice Sessions",
                    href: "/practice",
                  },
                  { type: "link", text: "Live Assistant", href: "/assistant" },
                  {
                    type: "link",
                    text: "Interview Sessions",
                    href: "/candidate/sessions",
                  },
                ],
              },
              { type: "divider" },
              {
                type: "section",
                text: "Interviewer View",
                items: [
                  {
                    type: "link",
                    text: "Schedule Interview",
                    href: "/interviewer/create",
                  },
                  {
                    type: "link",
                    text: "Live Assistant",
                    href: "/interviewer/live",
                  },
                  {
                    type: "link",
                    text: "Interview Sessions",
                    href: "/interviewer/sessions",
                  },
                ],
              },
              { type: "divider" },
              { type: "link", text: "Settings", href: "/settings" },
            ]}
          />
        }
        breadcrumbs={
          <BreadcrumbGroup
            items={getBreadcrumbs()}
            onFollow={(event) => {
              event.preventDefault();
              navigate(event.detail.href);
            }}
          />
        }
        notifications={
          <Flashbar
            items={notifications}
            onDismiss={({ detail }) => removeNotification(detail.id)}
          />
        }
        content={
          <Routes>
            <Route path="/" element={<Dashboard />} />

            {/* Candidate View Routes */}
            <Route path="/prepare" element={<PrepareInterviewList />} />
            <Route path="/prepare/new" element={<PrepareInterviewNew />} />
            <Route
              path="/prepare/:planId"
              element={<PrepareInterviewDetail />}
            />
            <Route path="/practice" element={<LivePractice />} />
            <Route path="/practice/new" element={<LivePracticeNew />} />
            <Route
              path="/practice/session/:sessionId/view"
              element={<PracticeSessionDetail />}
            />
            <Route
              path="/practice/session/:sessionId"
              element={<LivePracticeSession user={user} />}
            />
            <Route path="/practice/wizard" element={<PracticeWizard />} />
            <Route path="/assistant" element={<LiveAssistant user={user} />} />
            <Route
              path="/candidate/live-assistant"
              element={<LiveAssistant user={user} />}
            />
            <Route
              path="/candidate/sessions"
              element={<CandidateSessionList />}
            />
            <Route
              path="/candidate/sessions/:sessionId"
              element={<CandidateSessionDetail />}
            />
            <Route path="/history" element={<SessionHistory />} />

            {/* Interviewer View Routes */}
            <Route path="/interviewer/create" element={<InterviewerList />} />
            <Route path="/interviewer/new" element={<InterviewerNew />} />
            <Route
              path="/interviewer/:interviewId"
              element={<InterviewerDetail />}
            />
            <Route
              path="/interviewer/live"
              element={<InterviewerLive user={user} />}
            />
            <Route
              path="/interviewer/sessions"
              element={<InterviewerSessionList />}
            />
            <Route
              path="/interviewer/sessions/:sessionId"
              element={<InterviewerSessionDetail />}
            />

            {/* Settings */}
            <Route path="/settings" element={<Settings />} />
          </Routes>
        }
        toolsHide
      />
    </div>
  );
}

function App() {
  if (NO_AUTH) {
    console.warn(
      "⚠️ NO_AUTH mode is enabled - Authentication is BYPASSED for local development",
    );
    return (
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppContent user={{ username: "Dev User", email: "dev@local" }} />
      </Router>
    );
  }
  // Production mode with authentication - use custom sign-in component directly
  return <CustomAuthenticatedApp />;
}

// Custom authenticated app wrapper
function CustomAuthenticatedApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const { fetchAuthSession, getCurrentUser } = await import(
        "aws-amplify/auth"
      );
      console.log("🔐 [Auth] Checking auth status...");

      const session = await fetchAuthSession();
      console.log("🔐 [Auth] Session object:", session);
      console.log("🔐 [Auth] Has tokens?", !!session?.tokens);
      console.log(
        "🔐 [Auth] Token keys:",
        session?.tokens ? Object.keys(session.tokens) : "no tokens",
      );

      if (session?.tokens) {
        console.log("🔐 [Auth] ✅ Valid session with tokens found");
        setIsAuthenticated(true);

        // Store Cognito ID token in localStorage for API requests
        const idToken = session.tokens.idToken?.toString();
        if (idToken) {
          localStorage.setItem("authToken", idToken);
          console.log(
            "🔐 [Auth] ✅ Stored ID token in localStorage for API requests",
          );
          console.log("🔐 [Auth] Full Bearer Token:", idToken);
          console.log(
            "🔐 [Auth] Full Authorization Header:",
            `Bearer ${idToken}`,
          );
          // Make token accessible via console for manual use
          window._authToken = idToken;
          console.log("🔐 [Auth] Token also available as: window._authToken");
        }

        // Try to get username from current user
        try {
          console.log("🔐 [Auth] Attempting to get current user...");
          const authUser = await getCurrentUser();
          console.log("🔐 [Auth] Current user:", authUser);
          console.log("🔐 [Auth] Username:", authUser.username);

          // Parse JWT to get email and other attributes
          if (idToken) {
            try {
              const payload = JSON.parse(atob(idToken.split(".")[1]));
              console.log("🔐 [Auth] JWT payload:", payload);

              // Extract both email and username
              const email = payload.email || null;
              const username =
                authUser.username ||
                authUser.signInDetails?.loginId ||
                payload["cognito:username"] ||
                "User";
              const sub = payload.sub || null;

              console.log("🔐 [Auth] Extracted user attributes:", {
                email,
                username,
                sub,
              });

              // CRITICAL: Set email, username, and sub for proper DynamoDB queries
              setUser({
                email, // Primary: Used for DynamoDB queries
                username, // Fallback: Display name
                sub, // Unique ID: Cognito user identifier
              });
            } catch (jwtError) {
              console.warn(
                "🔐 [Auth] Could not parse JWT for attributes:",
                jwtError,
              );
              setUser({
                username: authUser.username || authUser.signInDetails?.loginId,
              });
            }
          } else {
            setUser({
              username: authUser.username || authUser.signInDetails?.loginId,
            });
          }
        } catch (userError) {
          console.warn("🔐 [Auth] Could not get user details:", userError);

          // Try to parse JWT for user info
          try {
            if (idToken) {
              console.log(
                "🔐 [Auth] Found ID token, attempting to parse JWT...",
              );
              const payload = JSON.parse(atob(idToken.split(".")[1]));
              console.log("🔐 [Auth] JWT payload:", payload);

              // Extract email, username, and sub from JWT
              const email = payload.email || null;
              const username =
                payload.preferred_username ||
                payload["cognito:username"] ||
                "User";
              const sub = payload.sub || null;

              console.log("🔐 [Auth] Extracted user attributes from JWT:", {
                email,
                username,
                sub,
              });

              // CRITICAL: Set email, username, and sub for proper DynamoDB queries
              setUser({
                email, // Primary: Used for DynamoDB queries
                username, // Fallback: Display name
                sub, // Unique ID: Cognito user identifier
              });
            } else {
              setUser({ username: "User" });
            }
          } catch (jwtError) {
            console.warn("🔐 [Auth] Could not parse JWT:", jwtError);
            setUser({ username: "User" });
          }
        }
      } else {
        console.log("🔐 [Auth] ❌ No valid session/tokens found");
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error("🔐 [Auth] Error during auth check:", error);
      console.error("🔐 [Auth] Error details:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      setIsAuthenticated(false);
    } finally {
      console.log("🔐 [Auth] Auth check complete");
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      console.log("🔐 [SignOut] Attempting to sign out...");
      const { signOut } = await import("aws-amplify/auth");
      console.log("🔐 [SignOut] Calling Amplify signOut()...");
      await signOut();
      console.log("🔐 [SignOut] ✅ Sign out successful");
      // Clear stored auth token
      localStorage.removeItem("authToken");
      console.log("🔐 [SignOut] ✅ Cleared authToken from localStorage");
      setIsAuthenticated(false);
      setUser(null);
      console.log("🔐 [SignOut] State updated - user should see login screen");
    } catch (error) {
      console.error("🔐 [SignOut] ❌ Error during sign out:", error);
      console.error("🔐 [SignOut] Error details:", {
        message: error.message,
        name: error.name,
      });
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h2>Loading...</h2>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <CustomSignIn />;
  }

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppContent signOut={handleSignOut} user={user} />
    </Router>
  );
}

export default App;
