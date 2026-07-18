// --- Imports ---
import * as SQLite from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

/**
 * Simple Daily Protein Tracker with Edit Functionality
 * SQLite tables:
 *   settings(goal_protein_g REAL)
 *   entries(id INTEGER PK, day TEXT YYYY-MM-DD, name TEXT, protein_g REAL, calories REAL, created_at TEXT)
 */

let db = null;

// --- Color System ---
const Colors = {
  light: {
    background: "#f5f5f5",
    surface: "#ffffff",
    surfaceBorder: "#e0e0e0",
    primary: "#5b7cff",
    primaryText: "#ffffff",
    text: "#1f2937",
    textSecondary: "#6b7280",
    textTertiary: "#9ca3af",
    inputBg: "#f9fafb",
    inputBorder: "#d1d5db",
    progressBg: "#e5e7eb",
    progressFill: "#5b7cff",
    danger: "#dc2626",
    tabbar: "#ffffff",
    tabInactive: "#9ca3af",
    tabActive: "#1f2937",
    tabActiveBg: "#f3f4f6",
  },
  dark: {
    background: "#0f1530",
    surface: "#161d3a",
    surfaceBorder: "#24305f",
    primary: "#5b7cff",
    primaryText: "#0b1020",
    text: "#ffffff",
    textSecondary: "#dde3ff",
    textTertiary: "#a8b0d9",
    inputBg: "#0f1530",
    inputBorder: "#2b3772",
    progressBg: "#0b1020",
    progressFill: "#58f",
    danger: "#b00020",
    tabbar: "#0b1020",
    tabInactive: "#98a3d4",
    tabActive: "#ffffff",
    tabActiveBg: "#161d3a",
  },
};

const getColors = (scheme) => Colors[scheme] || Colors.dark;

// --- DB Setup ---
async function getDatabase() {
  if (!db) {
    db = await SQLite.openDatabaseAsync("protein.db");
  }
  return db;
}

async function runMigrations() {
  const database = await getDatabase();
  
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY NOT NULL,
      goal_protein_g REAL NOT NULL
    );
  `);
  
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY NOT NULL,
      day TEXT NOT NULL,
      name TEXT NOT NULL,
      protein_g REAL NOT NULL,
      calories REAL,
      created_at TEXT NOT NULL
    );
  `);
  
  // ensure default settings row
  await database.execAsync(`
    INSERT INTO settings (id, goal_protein_g)
    SELECT 1, 120.0
    WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);
  `);

  // Calorie goal column — safe no-op if already exists
  await database.execAsync(
    `ALTER TABLE settings ADD COLUMN goal_calories_kcal REAL DEFAULT 2000;`
  ).catch(() => {});
}

// --- Onboarding Setup ---
async function getOnboardingStatus() {
  const database = await getDatabase();
  
  // Check if onboarding table exists, create if not
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS onboarding (
      id INTEGER PRIMARY KEY NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );
  `);
  
  // Check if onboarding is completed
  const result = await database.getFirstAsync(
    "SELECT completed FROM onboarding WHERE id = 1;"
  );
  
  // If no record exists, insert default
  if (!result) {
    await database.runAsync(
      "INSERT INTO onboarding (id, completed) VALUES (1, 0);"
    );
    return false;
  }
  
  return result.completed === 1;
}

async function setOnboardingCompleted() {
  const database = await getDatabase();
  await database.runAsync(
    "INSERT OR REPLACE INTO onboarding (id, completed) VALUES (1, 1);"
  );
}

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// --- UI helpers ---
function Button({ title, onPress, variant = "primary", disabled, colors }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: variant === "primary" ? colors.primary : "transparent" },
        variant === "secondary" && { borderWidth: 1, borderColor: colors.danger },
        disabled && styles.btnDisabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          { color: variant === "primary" ? colors.primaryText : colors.danger },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Card({ children, style, colors }) {
  return (
    <View style={[
      styles.card, 
      { 
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder 
      },
      style
    ]}>
      {children}
    </View>
  );
}

function ProgressBar({ value, max, colors }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <View style={[styles.progressOuter, { backgroundColor: colors.progressBg }]}>
      <View style={[styles.progressInner, { width: `${pct * 100}%`, backgroundColor: colors.progressFill }]} />
    </View>
  );
}

// --- Screens ---
function TodayScreen({ colors }) {
  const [goal, setGoal] = useState(120);
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [entries, setEntries] = useState([]);
  const [name, setName] = useState("");
  const [protein, setProtein] = useState("");
  const [calories, setCalories] = useState("");
  const [editingId, setEditingId] = useState(null);

  const totalProtein = useMemo(
    () => entries.reduce((sum, e) => sum + (e.protein_g || 0), 0),
    [entries]
  );
  const totalCalories = useMemo(
    () => entries.reduce((sum, e) => sum + (e.calories || 0), 0),
    [entries]
  );

  useEffect(() => {
    async function init() {
      await runMigrations();
      await refreshGoal();
      await refreshEntries();
    }
    init();
  }, []);

  async function refreshGoal() {
    const database = await getDatabase();
    const result = await database.getFirstAsync(
      "SELECT goal_protein_g, goal_calories_kcal FROM settings WHERE id = 1;"
    );
    if (result) {
      setGoal(result.goal_protein_g);
      setCalorieGoal(result.goal_calories_kcal ?? 2000); // add this
    }
  }

  async function refreshEntries() {
    const database = await getDatabase();
    const results = await database.getAllAsync(
      "SELECT * FROM entries WHERE day = ? ORDER BY created_at DESC;",
      [todayStr()]
    );
    setEntries(results || []);
  }

  function clearForm() {
    setName("");
    setProtein("");
    setCalories("");
    setEditingId(null);
  }

  async function addEntry() {
    const p = parseFloat(protein);
    if (!name.trim())
      return Alert.alert("Missing name", "Add a short label like 'Chicken breast'.");
    
    const p = protein.trim() ? parseFloat(protein) : 0;
    const c = calories.trim() ? parseFloat(calories) : null;
    const nowISO = new Date().toISOString();
    const database = await getDatabase();

    if (editingId) {
      await database.runAsync(
        "UPDATE entries SET name = ?, protein_g = ?, calories = ? WHERE id = ?;",
        [name.trim(), p, c, editingId]
      );
    } else {
      await database.runAsync(
        "INSERT INTO entries (day, name, protein_g, calories, created_at) VALUES (?, ?, ?, ?, ?);",
        [todayStr(), name.trim(), p, c, nowISO]
      );
    }
    
    clearForm();
    await refreshEntries();
  }

  async function deleteEntry(id) {
    const database = await getDatabase();
    await database.runAsync("DELETE FROM entries WHERE id = ?;", [id]);
    if (editingId === id) clearForm();
    await refreshEntries();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <FlatList
        ListHeaderComponent={
          <View>
            <Text style={[styles.h1, { color: colors.text }]}>Today</Text>
            <Card colors={colors}>
              <View style={styles.rowSpace}>
                <View>
                  <Text style={[styles.kpiLabel, { color: colors.textTertiary }]}>Protein</Text>
                  <Text style={[styles.kpiValue, { color: colors.text }]}>
                    {Math.round(totalProtein)} / {Math.round(goal)} g
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.kpiLabel, { color: colors.textTertiary }]}>Calories</Text>
                  <Text style={[styles.kpiValue, { color: colors.text }]}>
                    {Math.round(totalCalories)} / {Math.round(calorieGoal)} kcal
                  </Text>
                </View>
              </View>
              <ProgressBar value={totalProtein} max={goal} colors={colors} />
              <View style={{ marginTop: 6 }}>
                <ProgressBar value={totalCalories} max={calorieGoal} colors={colors} />
              </View>
            </Card>

            <Card colors={colors}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                {editingId ? "Edit item" : "Add item"}
              </Text>
              <TextInput
                placeholder="Name (e.g., Greek yogurt)"
                value={name}
                onChangeText={setName}
                style={[styles.input, { 
                  backgroundColor: colors.inputBg, 
                  borderColor: colors.inputBorder,
                  color: colors.text 
                }]}
                placeholderTextColor={colors.textTertiary}
              />
              <View style={styles.row}>
              <TextInput
                placeholder="Protein (g) — optional"
                keyboardType="decimal-pad"
                value={protein}
                onChangeText={setProtein}
                style={[styles.input, { 
                  flex: 0.40,  // slightly smaller
                  backgroundColor: colors.inputBg, 
                  borderColor: colors.inputBorder,
                  color: colors.text 
                }]}
                placeholderTextColor={colors.textTertiary}
              />
              <View style={{ width: 12 }} />
              <TextInput
                placeholder="Calories (optional)"
                keyboardType="decimal-pad"
                value={calories}
                onChangeText={setCalories}
                style={[styles.input, { 
                  flex: 0.60,  // slightly larger
                  backgroundColor: colors.inputBg, 
                  borderColor: colors.inputBorder,
                  color: colors.text 
                }]}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
              <Button 
                title={editingId ? "Update" : "Log"} 
                onPress={addEntry}
                colors={colors}
              />
              {editingId && (
                <Button
                  title="Cancel Edit"
                  variant="secondary"
                  onPress={clearForm}
                  colors={colors}
                />
              )}
            </Card>

            <Text style={[styles.sectionTitle, { marginTop: 8, color: colors.textSecondary }]}>
              Logged items
            </Text>
          </View>
        }
        data={entries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const isActive = item.id === editingId;
          return (
            <Card colors={colors} style={[styles.listItem, isActive && { borderColor: colors.primary, borderWidth: 2 }]}>
              <View style={styles.rowSpace}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
                    {new Date(item.created_at).toLocaleTimeString()}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.itemProtein, { color: colors.text }]}>
                    {Math.round(item.protein_g)} g
                  </Text>
                  {!!item.calories && (
                    <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
                      {Math.round(item.calories)} kcal
                    </Text>
                  )}

                  <Pressable
                    onPress={() => {
                      setName(item.name);
                      setProtein(String(item.protein_g));
                      setCalories(item.calories ? String(item.calories) : "");
                      setEditingId(item.id);
                    }}
                    style={[styles.editBtn, { borderColor: colors.surfaceBorder }]}
                  >
                    <Text style={[styles.deleteTxt, { color: colors.textSecondary }]}>Edit</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => deleteEntry(item.id)}
                    style={[styles.delete, { borderColor: colors.surfaceBorder }]}
                  >
                    <Text style={[styles.deleteTxt, { color: colors.textSecondary }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textTertiary }]}>Nothing logged yet.</Text>
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      />
    </KeyboardAvoidingView>
  );
}

function HistoryScreen({ colors }) {
  const [sections, setSections] = useState([]);

  useEffect(() => {
    async function init() {
      await runMigrations();
      await refresh();
    }
    init();
  }, []);

  async function refresh() {
    const database = await getDatabase();
    const results = await database.getAllAsync(`
      SELECT * FROM entries
      WHERE day >= date('now','-30 day')
      ORDER BY day DESC, created_at DESC;
    `);

    // Group into sections by day
    const map = {};
    for (const entry of results || []) {
      if (!map[entry.day]) map[entry.day] = [];
      map[entry.day].push(entry);
    }
    setSections(
      Object.entries(map).map(([day, data]) => ({ title: day, data }))
    );
  }

  async function reAddEntry(entry) {
    const today = todayStr();
    if (entry.day === today) {
      Alert.alert("Already today", "This entry is already logged for today.");
      return;
    }
    const database = await getDatabase();
    await database.runAsync(
      "INSERT INTO entries (day, name, protein_g, calories, created_at) VALUES (?, ?, ?, ?, ?);",
      [today, entry.name, entry.protein_g, entry.calories ?? null, new Date().toISOString()]
    );
    Alert.alert("Added!", `"${entry.name}" has been added to today.`);
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={
        <View style={{ padding: 16 }}>
          <Text style={[styles.h1, { color: colors.text }]}>History (30 days)</Text>
        </View>
      }
      renderSectionHeader={({ section: { title } }) => (
        <Text style={[styles.dayHeader, { color: colors.textTertiary, backgroundColor: colors.background }]}>
          {title}
        </Text>
      )}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <Card colors={colors}>
            <View style={styles.rowSpace}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
                {!!item.calories && (
                  <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
                    {Math.round(item.calories)} kcal
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.itemProtein, { color: colors.text }]}>
                  {Math.round(item.protein_g)} g
                </Text>
                <Pressable
                  onPress={() => reAddEntry(item)}
                  style={[styles.reAddBtn, { borderColor: colors.primary }]}
                >
                  <Text style={[styles.reAddTxt, { color: colors.primary }]}>+ Today</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        </View>
      )}
      ListEmptyComponent={
        <Text style={[styles.empty, { padding: 16, color: colors.textTertiary }]}>
          No history yet.
        </Text>
      }
    />
  );
}

function SettingsScreen({ onNavigate, colors }) {
  const [goal, setGoal] = useState("120");
  const [calorieGoal, setCalorieGoal] = useState("2000");

  useEffect(() => {
    async function init() {
      await runMigrations();
      const database = await getDatabase();
      const result = await database.getFirstAsync(
        "SELECT goal_protein_g, goal_calories_kcal FROM settings WHERE id = 1;"
      );
      if (result) {
        setGoal(String(result.goal_protein_g));
        setCalorieGoal(String(result.goal_calories_kcal ?? 2000));
      }
    }
    init();
  }, []);

  async function save() {
    const g = parseFloat(goal);
    const c = parseFloat(calorieGoal);
    if (isNaN(g) || g <= 0)
      return Alert.alert("Invalid goal", "Enter a positive number of grams.");
    if (isNaN(c) || c <= 0)
      return Alert.alert("Invalid goal", "Enter a positive calorie target.");

    const database = await getDatabase();
    await database.runAsync(
      "UPDATE settings SET goal_protein_g = ?, goal_calories_kcal = ? WHERE id = 1;",
      [g, c]
    );
    Alert.alert("Saved", "Goals updated.");
  }

  function clearAll() {
    Alert.alert(
      "Delete all data?",
      "This will remove ALL your logged entries. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const database = await getDatabase();
            await database.runAsync("DELETE FROM entries;");
          },
        },
      ]
    );
  }
  async function sendFeedback() {
    const email = 'contact@darklotus.dev';
    const subject = encodeURIComponent('Protein Tracker Feedback');
    const body = encodeURIComponent(
      `Hi Dark Lotus Dev,\n\n` +
      `[ Describe your feedback, suggestion, or bug below ]\n\n` +
      `---\n` +
      `Type: [ Bug Report / Feature Request / General Feedback ]\n\n` +
      `Details:\n\n\n` +
      `---\n` +
      `App Version: 1.2.0\n` +
      `Device: ${Platform.OS} ${Platform.Version}`
    );
    const url = `mailto:${email}?subject=${subject}&body=${body}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('No Email App Found', `Email us at:\n\ncontact@darklotus.dev`, [{ text: 'OK' }]);
    }
  }

  function openReview() {
    Linking.openURL(
      'https://play.google.com/store/apps/details?id=com.darklotusdev.proteintracker&showAllReviews=true'
    );
  }
  return (
    <View style={{ padding: 16 }}>
      <Text style={[styles.h1, { color: colors.text }]}>Settings</Text>
      <Card colors={colors}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Daily protein goal (g)</Text>
        <TextInput
          value={goal}
          onChangeText={setGoal}
          keyboardType="decimal-pad"
          style={[styles.input, { 
            marginBottom: 12,
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.text
          }]}
          placeholderTextColor={colors.textTertiary}
        />
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Daily calorie goal (kcal)</Text>
        <TextInput
          value={calorieGoal}
          onChangeText={setCalorieGoal}
          keyboardType="decimal-pad"
          style={[styles.input, {
            marginBottom: 12,
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
            color: colors.text
          }]}
          placeholderTextColor={colors.textTertiary}
          placeholder="2000"
        />
        <Button title="Save" onPress={save} colors={colors} />
      </Card>
      <Card colors={colors} style={{ marginTop: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Support</Text>
        <Button title="Send Feedback" onPress={sendFeedback} colors={colors} />
        <Button title="Rate & Review" onPress={openReview} colors={colors} />
      </Card>
      <Card colors={colors} style={{ marginTop: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.danger }]}>
          Danger zone
        </Text>
        <Button
          title="Delete all entries"
          variant="secondary"
          onPress={clearAll}
          colors={colors}
        />
      </Card>

      <Card colors={colors} style={{ marginTop: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Legal</Text>
        <Button
          title="Privacy Policy"
          onPress={() => onNavigate("privacy")}
          colors={colors}
        />
        <Button
          title="Terms of Service"
          onPress={() => onNavigate("terms")}
          colors={colors}
        />
      </Card>
    </View>
  );
}

// WebView Screen Component
function WebViewScreen({ url, title, colors }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { backgroundColor: colors.tabbar, borderBottomColor: colors.surfaceBorder }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <WebView
        source={{ uri: url }}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentMode="mobile"
        scalesPageToFit={true}
        startInLoadingState={true}
      />
    </View>
  );
}
// --- Onboarding Component ---
function OnboardingModal({ onComplete, colors }) {
  const [currentScreen, setCurrentScreen] = useState(0);

  const screens = [
    {
      title: "Welcome to Protein Tracker",
      description: "Track your daily protein intake easily and reach your fitness goals.",          
    },
    {
      title: "Log Your Meals",
      description: "Add entries throughout the day with protein and calorie counts. Quick and simple.",    
    },
    {
      title: "Track Your Progress",
      description: "Monitor your daily goals and view your history over the past 30 days.",      
    },
  ];

  const isLastScreen = currentScreen === screens.length - 1;

  return (
    <View style={[styles.onboardingOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.85)' }]}>
      <View style={[styles.onboardingModal, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
        {/* Skip button */}
        {!isLastScreen && (
          <Pressable 
            style={styles.skipButton}
            onPress={onComplete}
          >
            <Text style={[styles.skipText, { color: colors.textSecondary }]}>Skip</Text>
          </Pressable>
        )}

        {/* Content */}
        <View style={styles.onboardingContent}>
          <Text style={styles.onboardingEmoji}>{screens[currentScreen].emoji}</Text>
          <Text style={[styles.onboardingTitle, { color: colors.text }]}>
            {screens[currentScreen].title}
          </Text>
          <Text style={[styles.onboardingDescription, { color: colors.textSecondary }]}>
            {screens[currentScreen].description}
          </Text>
        </View>

        {/* Progress dots */}
        <View style={styles.dotsContainer}>
          {screens.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: index === currentScreen ? colors.primary : colors.surfaceBorder,
                },
              ]}
            />
          ))}
        </View>

        {/* Navigation buttons */}
        <View style={styles.onboardingButtons}>
          {currentScreen > 0 && (
            <Pressable
              style={[styles.navButton, { borderColor: colors.surfaceBorder }]}
              onPress={() => setCurrentScreen(currentScreen - 1)}
            >
              <Text style={[styles.navButtonText, { color: colors.textSecondary }]}>Back</Text>
            </Pressable>
          )}
          
          <Pressable
            style={[
              styles.navButton,
              styles.primaryButton,
              { backgroundColor: colors.primary },
              currentScreen === 0 && { flex: 1 }
            ]}
            onPress={() => {
              if (isLastScreen) {
                onComplete();
              } else {
                setCurrentScreen(currentScreen + 1);
              }
            }}
          >
            <Text style={[styles.navButtonText, { color: colors.primaryText }]}>
              {isLastScreen ? "Get Started" : "Next"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// --- App UI ---
function App() {
  const [tab, setTab] = useState("today");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const colorScheme = useColorScheme();
  const colors = getColors(colorScheme);

  useEffect(() => {
    async function checkOnboarding() {
      await runMigrations();
      const completed = await getOnboardingStatus();
      setShowOnboarding(!completed);
      setOnboardingChecked(true);
    }
    checkOnboarding();
  }, []);

  async function handleOnboardingComplete() {
    await setOnboardingCompleted();
    setShowOnboarding(false);
  }

  // Don't render anything until onboarding status is checked
  if (!onboardingChecked) {
    return null;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.tabbar }}>
      {!["privacy", "terms"].includes(tab) && (
        <View style={[styles.tabbar, { backgroundColor: colors.tabbar }]}>
          {["today", "history", "settings"].map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tab, 
                { borderColor: colors.surfaceBorder },
                tab === t && { backgroundColor: colors.tabActiveBg }
              ]}
            >
              <Text style={[
                styles.tabTxt, 
                { color: tab === t ? colors.tabActive : colors.tabInactive }
              ]}>
                {t === "today"
                  ? "Today"
                  : t === "history"
                  ? "History"
                  : "Settings"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {tab === "today" && <TodayScreen colors={colors} />}
        {tab === "history" && <HistoryScreen colors={colors} />}
        {tab === "settings" && <SettingsScreen onNavigate={setTab} colors={colors} />}
        {tab === "privacy" && (
          <WebViewScreen
            url="https://verdiecraig.github.io/protein-tracker/privacy-policy"
            title="Privacy Policy"
            colors={colors}
          />
        )}
        {tab === "terms" && (
          <WebViewScreen
            url="https://verdiecraig.github.io/protein-tracker/terms-of-service"
            title="Terms of Service"
            colors={colors}
          />
        )}
      </View>

      {["privacy", "terms"].includes(tab) && (
        <Pressable
          style={[styles.backButton, { backgroundColor: colors.surface, borderTopColor: colors.surfaceBorder }]}
          onPress={() => setTab("settings")}
        >
          <Text style={[styles.backButtonText, { color: colors.primary }]}>← Back to Settings</Text>
        </Pressable>
      )}

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal onComplete={handleOnboardingComplete} colors={colors} />
      )}
    </SafeAreaView>
  );
}

// --- Export for Expo Router ---
export default function Index() {
  return <App />;
}

// --- Styles ---
const styles = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  card: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  row: { flexDirection: "row", alignItems: "center" },
  rowSpace: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kpiLabel: { fontSize: 12 },
  kpiValue: { fontSize: 20, fontWeight: "800" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  inputHalf: { flex: 1 },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontWeight: "700", fontSize: 16 },
  listItem: {},
  itemName: { fontSize: 16, fontWeight: "600" },
  itemSub: { fontSize: 12, marginTop: 2 },
  itemProtein: { fontSize: 16, fontWeight: "800" },
  editBtn: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  delete: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  deleteTxt: { fontSize: 12 },
  dayHeader: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 6,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  reAddBtn: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  reAddTxt: {
    fontSize: 12,
    fontWeight: "600",
  },
  empty: { textAlign: "center" },
  progressOuter: {
    height: 12,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 10,
  },
  progressInner: { height: 12, borderRadius: 999 },
  tabbar: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  tabTxt: { fontWeight: "700" },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
    // Add these new onboarding styles:
  onboardingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  onboardingModal: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  skipButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
    zIndex: 1,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600',
  },
  onboardingContent: {
    alignItems: 'center',
    marginBottom: 32,
  },
  onboardingEmoji: {
    fontSize: 64,
    marginBottom: 24,
  },
  onboardingTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  onboardingDescription: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onboardingButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  navButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primaryButton: {
    borderWidth: 0,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
