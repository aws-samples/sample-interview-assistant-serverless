import * as fs from "fs";
import * as path from "path";

export interface InterviewConfig {
  cvFilename: string;
  jobDescriptionFilename: string;
  companyName: string;
  jobTitle: string;
  interviewMode?: "light" | "smart";
}

export interface TestScenario {
  name: string;
  folderPath: string;
  audioFilePaths: string[];
  config: InterviewConfig;
}

/**
 * Loads and validates an interview scenario config file
 * @param scenarioPath Path to the scenario folder
 * @returns Parsed config or default config if file doesn't exist
 */
function loadInterviewConfig(scenarioPath: string): InterviewConfig {
  const configPath = path.join(scenarioPath, "config.json");

  const defaultConfig: InterviewConfig = {
    cvFilename: "CV.pdf",
    jobDescriptionFilename: "JobDescription.pdf",
    companyName: "Test Company",
    jobTitle: "Software Engineer",
    interviewMode: "light",
  };

  if (!fs.existsSync(configPath)) {
    console.warn(
      `⚠️ Config file not found at ${configPath}, using default config`,
    );
    return defaultConfig;
  }

  try {
    const configData = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData) as InterviewConfig;

    // Validate required fields
    if (
      !config.cvFilename ||
      !config.jobDescriptionFilename ||
      !config.companyName ||
      !config.jobTitle
    ) {
      console.warn(
        `⚠️ Config missing required fields in ${configPath}, using defaults for missing fields`,
      );
      return { ...defaultConfig, ...config };
    }

    // Validate interviewMode if provided
    if (
      config.interviewMode &&
      !["light", "smart"].includes(config.interviewMode)
    ) {
      console.warn(
        `⚠️ Invalid interviewMode "${config.interviewMode}" in ${configPath}, using default "light"`,
      );
      return { ...config, interviewMode: "light" };
    }

    return config;
  } catch (error) {
    console.error(`❌ Error parsing config file at ${configPath}:`, error);
    return defaultConfig;
  }
}

/**
 * Scans the test_data directory for test scenarios
 * Each subdirectory is a test scenario containing numerically-prefixed .wav files and a config.json
 * @param testDataRoot Root path to test_data folder (e.g., './test_data')
 * @param prefix Optional prefix to filter subdirectories (e.g., 'candidate_', 'interviewer_'). If not provided, scans all directories.
 * @returns Array of test scenarios sorted by folder name
 */
export function scanTestScenarios(
  testDataRoot: string,
  prefix?: string,
): TestScenario[] {
  const scenarios: TestScenario[] = [];

  if (!fs.existsSync(testDataRoot)) {
    console.warn(`Test data root not found: ${testDataRoot}`);
    return scenarios;
  }

  // Read all directories in test_data
  const entries = fs.readdirSync(testDataRoot, { withFileTypes: true });
  let subdirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Filter by prefix if provided
  if (prefix) {
    subdirs = subdirs.filter((name) => name.startsWith(prefix));
    console.log(
      `🔍 Filtering test scenarios with prefix "${prefix}" - found ${subdirs.length} matching directories`,
    );
  }

  // Sort subdirectories alphabetically
  subdirs.sort();

  // Process each subdirectory as a test scenario
  subdirs.forEach((subdir) => {
    const scenarioPath = path.join(testDataRoot, subdir);
    const audioFiles = fs
      .readdirSync(scenarioPath)
      .filter((file) => file.endsWith(".wav"))
      .sort((a, b) => {
        // Extract numeric prefix and sort numerically
        const numA = parseInt(a.split("_")[0], 10);
        const numB = parseInt(b.split("_")[0], 10);
        return numA - numB;
      });

    if (audioFiles.length > 0) {
      const audioFilePaths = audioFiles.map((file) =>
        path.resolve(path.join(scenarioPath, file)),
      );
      const config = loadInterviewConfig(scenarioPath);

      scenarios.push({
        name: subdir,
        folderPath: scenarioPath,
        audioFilePaths,
        config,
      });

      console.log(
        `✅ Test scenario detected: ${subdir} (${audioFiles.length} audio files, company: ${config.companyName}, mode: ${config.interviewMode})`,
      );
    } else {
      console.warn(`⚠️ Skipping ${subdir} - no .wav files found`);
    }
  });

  console.log(`📊 Total test scenarios found: ${scenarios.length}`);
  return scenarios;
}

/**
 * Get a single test scenario by name
 * @param testDataRoot Root path to test_data folder
 * @param scenarioName Name of the scenario to retrieve
 * @param prefix Optional prefix to filter subdirectories (e.g., 'candidate_', 'interviewer_')
 * @returns Test scenario or null if not found
 */
export function getTestScenario(
  testDataRoot: string,
  scenarioName: string,
  prefix?: string,
): TestScenario | null {
  const scenarios = scanTestScenarios(testDataRoot, prefix);
  return scenarios.find((s) => s.name === scenarioName) || null;
}
