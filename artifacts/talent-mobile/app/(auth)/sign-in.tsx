import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  useLoginUser,
} from "@workspace/api-client-react";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ email?: string }>();
  const prefillEmail =
    typeof params.email === "string" && params.email.length > 0
      ? params.email
      : null;

  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Pre-fill the email when arriving from sign-up with a duplicate-email
  // hand-off.  Only applied while the field is still empty so we never
  // clobber what the user has started typing.
  useEffect(() => {
    if (prefillEmail && email.length === 0) {
      setEmail(prefillEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillEmail]);

  const login = useLoginUser({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        router.replace("/(tabs)");
      },
      onError: (err: unknown) => {
        const data = (err as { data?: { error?: string } | null } | null)
          ?.data;
        setError(data?.error ?? "Could not sign in. Check your credentials.");
      },
    },
  });

  const onSubmit = () => {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }
    login.mutate({ data: { email: trimmedEmail, password } });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
          gap: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: 12 }}>
          <View
            style={[
              styles.logoWrap,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius * 2,
              },
            ]}
          >
            <Feather
              name="briefcase"
              size={28}
              color={colors.primaryForeground}
            />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Welcome back
          </Text>
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
          >
            Sign in to continue your job search.
          </Text>
        </View>

        <View style={{ gap: 14 }}>
          <Field
            icon="mail"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            icon="lock"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            rightAccessory={
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={8}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            }
          />

          {error ? (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: colors.destructive + "1A",
                  borderColor: colors.destructive,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather
                name="alert-circle"
                size={14}
                color={colors.destructive}
              />
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                {error}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={onSubmit}
            disabled={login.isPending}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius * 1.25,
                opacity: pressed || login.isPending ? 0.85 : 1,
              },
            ]}
          >
            {login.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Sign in
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footerRow}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            New here?{" "}
          </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable hitSlop={6}>
              <Text
                style={{
                  color: colors.primary,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                Create a candidate account
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {
  icon: React.ComponentProps<typeof Feather>["name"];
  rightAccessory?: React.ReactNode;
};

export function Field({ icon, rightAccessory, style, ...rest }: FieldProps) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: colors.secondary,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.25,
        },
      ]}
    >
      <Feather name={icon} size={16} color={colors.mutedForeground} />
      <TextInput
        {...rest}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          { color: colors.foreground, fontFamily: "Inter_500Medium" },
          style,
        ]}
      />
      {rightAccessory}
    </View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  primaryButton: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderWidth: 1,
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
});
