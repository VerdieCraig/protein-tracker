// --- Imports ---
import * as SQLite from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Simple Daily Protein Tracker with Edit Functionality
 * SQLite tables:
 *   settings(goal_protein_g REAL)
 *   entries(id INTEGER PK, day TEXT YYYY-MM-DD, name TEXT, protein_g REAL, calories REAL, created_at TEXT)
 */

let db = null;

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
}

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// --- UI helpers ---
function Button({ title, onPress, variant = "primary", disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === "secondary" && styles.btnSecondary,
        disabled && styles.btnDisabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === "secondary" && styles.btnTextSecondary,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function ProgressBar({ value, max }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <View style={styles.progressOuter}>
      <View style={[styles.progressInner, { width: `${pct * 100}%` }]} />
    </View>
  );
}

// --- Screens ---
function TodayScreen() {
  const [goal, setGoal] = useState(120);
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
      "SELECT goal_protein_g FROM settings WHERE id = 1;"
    );
    if (result) setGoal(result.goal_protein_g);
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
    if (isNaN(p) || p <= 0)
      return Alert.alert("Protein required", "Enter grams of protein (e.g., 32).");

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
            <Text style={styles.h1}>Today</Text>
            <Card>
              <View style={styles.rowSpace}>
                <View>
                  <Text style={styles.kpiLabel}>Protein</Text>
                  <Text style={styles.kpiValue}>
                    {Math.round(totalProtein)} / {Math.round(goal)} g
                  </Text>
                </View>
                <View>
                  <Text style={styles.kpiLabel}>Calories</Text>
                  <Text style={styles.kpiValue}>
                    {Math.round(totalCalories)} kcal
                  </Text>
                </View>
              </View>
              <ProgressBar value={totalProtein} max={goal} />
            </Card>

            <Card>
              <Text style={styles.sectionTitle}>
                {editingId ? "Edit item" : "Add item"}
              </Text>
              <TextInput
                placeholder="Name (e.g., Greek yogurt)"
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholderTextColor="#5a6998"
              />
              <View style={styles.row}>
                <TextInput
                  placeholder="Protein (g)"
                  keyboardType="decimal-pad"
                  value={protein}
                  onChangeText={setProtein}
                  style={[styles.input, styles.inputHalf]}
                  placeholderTextColor="#5a6998"
                />
                <View style={{ width: 12 }} />
                <TextInput
                  placeholder="Calories (optional)"
                  keyboardType="decimal-pad"
                  value={calories}
                  onChangeText={setCalories}
                  style={[styles.input, styles.inputHalf]}
                  placeholderTextColor="#5a6998"
                />
              </View>
              <Button title={editingId ? "Update" : "Log"} onPress={addEntry} />
              {editingId && (
                <Button
                  title="Cancel Edit"
                  variant="secondary"
                  onPress={clearForm}
                />
              )}
            </Card>

            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>
              Logged items
            </Text>
          </View>
        }
        data={entries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const isActive = item.id === editingId;
          return (
            <Card style={[styles.listItem, isActive && styles.activeCard]}>
              <View style={styles.rowSpace}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSub}>
                    {new Date(item.created_at).toLocaleTimeString()}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.itemProtein}>
                    {Math.round(item.protein_g)} g
                  </Text>
                  {!!item.calories && (
                    <Text style={styles.itemSub}>
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
                    style={styles.editBtn}
                  >
                    <Text style={styles.deleteTxt}>Edit</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => deleteEntry(item.id)}
                    style={styles.delete}
                  >
                    <Text style={styles.deleteTxt}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing logged yet.</Text>}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      />
    </KeyboardAvoidingView>
  );
}

function HistoryScreen() {
  const [rows, setRows] = useState([]);

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
      SELECT day,
             SUM(protein_g) AS protein_g,
             SUM(calories)  AS calories
      FROM entries
      WHERE day >= date('now','-30 day')
      GROUP BY day
      ORDER BY day DESC;
    `);
    setRows(results || []);
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(it) => it.day}
      ListHeaderComponent={
        <View style={{ padding: 16 }}>
          <Text style={styles.h1}>History (30 days)</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <Card>
            <View style={styles.rowSpace}>
              <Text style={styles.itemName}>{item.day}</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.itemProtein}>
                  {Math.round(item.protein_g)} g
                </Text>
                {!!item.calories && (
                  <Text style={styles.itemSub}>
                    {Math.round(item.calories)} kcal
                  </Text>
                )}
              </View>
            </View>
          </Card>
        </View>
      )}
      ListEmptyComponent={
        <Text style={[styles.empty, { padding: 16 }]}>No history yet.</Text>
      }
    />
  );
}

function SettingsScreen() {
  const [goal, setGoal] = useState("120");

  useEffect(() => {
    async function init() {
      await runMigrations();
      const database = await getDatabase();
      const result = await database.getFirstAsync(
        "SELECT goal_protein_g FROM settings WHERE id = 1;"
      );
      if (result) setGoal(String(result.goal_protein_g));
    }
    init();
  }, []);

  async function save() {
    const g = parseFloat(goal);
    if (isNaN(g) || g <= 0)
      return Alert.alert("Invalid goal", "Enter a positive number of grams.");
    
    const database = await getDatabase();
    await database.runAsync(
      "UPDATE settings SET goal_protein_g = ? WHERE id = 1;",
      [g]
    );
    Alert.alert("Saved", "Daily protein goal updated.");
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

  return (
    <View style={{ padding: 16 }}>
      <Text style={styles.h1}>Settings</Text>
      <Card>
        <Text style={styles.sectionTitle}>Daily protein goal (g)</Text>
        <TextInput
          value={goal}
          onChangeText={setGoal}
          keyboardType="decimal-pad"
          style={[styles.input, { marginBottom: 12 }]}
          placeholderTextColor="#5a6998"
        />
        <Button title="Save" onPress={save} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={[styles.sectionTitle, { color: "#b00020" }]}>
          Danger zone
        </Text>
        <Button
          title="Delete all entries"
          variant="secondary"
          onPress={clearAll}
        />
      </Card>
    </View>
  );
}

// --- App UI ---
function App() {
  const [tab, setTab] = useState("today");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1020" }}>
      <View style={styles.tabbar}>
        {["today", "history", "settings"].map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === "today"
                ? "Today"
                : t === "history"
                ? "History"
                : "Settings"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1, backgroundColor: "#0f1530" }}>
        {tab === "today" && <TodayScreen />}
        {tab === "history" && <HistoryScreen />}
        {tab === "settings" && <SettingsScreen />}
      </View>
    </SafeAreaView>
  );
}

// --- Export for Expo Router ---
export default function Index() {
  return <App />;
}

// --- Styles ---
const styles = StyleSheet.create({
  h1: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  sectionTitle: { color: "#dde3ff", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  card: {
    backgroundColor: "#161d3a",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#24305f",
    marginBottom: 10,
  },
  activeCard: { borderColor: "#5b7cff", borderWidth: 2 },
  row: { flexDirection: "row", alignItems: "center" },
  rowSpace: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kpiLabel: { color: "#a8b0d9", fontSize: 12 },
  kpiValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  input: {
    backgroundColor: "#0f1530",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2b3772",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    marginBottom: 10,
  },
  inputHalf: { flex: 1 },
  btn: {
    backgroundColor: "#5b7cff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  btnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#b00020",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#0b1020", fontWeight: "700", fontSize: 16 },
  btnTextSecondary: { color: "#b00020" },
  listItem: {},
  itemName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  itemSub: { color: "#9fb0ff", fontSize: 12, marginTop: 2 },
  itemProtein: { color: "#fff", fontSize: 16, fontWeight: "800" },
  editBtn: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3b466f",
  },
  delete: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3b466f",
  },
  deleteTxt: { color: "#a3aed6", fontSize: 12 },
  empty: { color: "#a8b0d9", textAlign: "center" },
  progressOuter: {
    height: 12,
    backgroundColor: "#0b1020",
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 10,
  },
  progressInner: { height: 12, backgroundColor: "#58f", borderRadius: 999 },
  tabbar: {
    flexDirection: "row",
    backgroundColor: "#0b1020",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#233066",
    alignItems: "center",
  },
  tabActive: { backgroundColor: "#161d3a" },
  tabTxt: { color: "#98a3d4", fontWeight: "700" },
  tabTxtActive: { color: "#fff" },
});