import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import Layout from "@/components/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation, useLanguage } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  User,
  Settings as SettingsIcon,
  Globe,
  Bell,
  Loader2,
  UserCircle,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Upload,
  BookOpen,
  CreditCard,
  X,
} from "lucide-react";

interface UserProfile {
  id: number;
  userId: number;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  language: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

interface UserPreferences {
  id: number;
  userId: number;
  enableNotifications: boolean;
  emailNotifications: boolean;
  practiceReminders: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LanguagePreferences {
  baseLanguage: string;
  learningLanguage: string;
}

const SUPPORTED_LANGUAGES = [
  { code: 'ko', name: '한국어', nameEn: 'Korean' },
  { code: 'en', name: 'English', nameEn: 'English' },
  { code: 'ja', name: '日本語', nameEn: 'Japanese' },
  { code: 'zh', name: '中文', nameEn: 'Chinese' },
  { code: 'es', name: 'Español', nameEn: 'Spanish' },
  { code: 'fr', name: 'Français', nameEn: 'French' },
  { code: 'de', name: 'Deutsch', nameEn: 'German' },
];

export default function Settings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { language: currentLanguage, setLanguage } = useLanguage();
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch user profile
  const { data: profile, isLoading: loadingProfile } = useQuery<UserProfile>({
    queryKey: ["/api/me/profile"],
  });

  // Fetch user preferences
  const { data: preferences, isLoading: loadingPreferences } =
    useQuery<UserPreferences>({
      queryKey: ["/api/me/preferences"],
    });

  // Fetch language learning preferences
  const { data: langPrefs, isLoading: loadingLangPrefs } =
    useQuery<LanguagePreferences>({
      queryKey: ["/api/me/language"],
    });

  // Profile form state
  const [profileData, setProfileData] = useState({
    avatarUrl: "",
    bio: "",
    language: currentLanguage,
    timezone: "Asia/Seoul",
  });

  // Preferences form state (notifications only)
  const [preferencesData, setPreferencesData] = useState({
    enableNotifications: true,
    emailNotifications: false,
    practiceReminders: true,
  });

  // Language learning preferences state
  const [langPrefsData, setLangPrefsData] = useState({
    baseLanguage: 'ko',
    learningLanguage: 'en',
  });

  // Payment history modal state
  const [isPaymentHistoryOpen, setIsPaymentHistoryOpen] = useState(false);

  // Get user's actual subscription plan from auth context
  const userPlan = user?.plan || 'starter'; // 'starter', 'pro', or 'admin'
  const userPlanType = user?.planType || user?.plan || 'starter';
  const userPlanExpiresAt = user?.planExpiresAt;

  // Format plan type for display
  const getPlanTypeDisplay = (planType: string) => {
    const planTypeKey = `settings.planTypes.${planType}` as const;
    // Try to get the translated plan type, fallback to default plan name
    const translated = t(planTypeKey);
    if (translated !== planTypeKey) {
      return translated;
    }
    // Fallback to base plan display based on userPlan
    if (userPlan === 'pro') return t("settings.proPlan");
    if (userPlan === 'admin') return t("settings.adminPlan");
    return t("settings.starterPlan");
  };

  // Format expiry date
  const formatExpiryDate = (expiresAt: string | null | undefined) => {
    if (!expiresAt) return null;
    const date = new Date(expiresAt);
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\./g, '.').slice(0, -1);
  };

  // Mock payment history (in a real app, this would come from an API)
  const paymentHistory: { date: string; plan: string; amount: string; status: 'completed' | 'pending' | 'failed' }[] = [];

  // Account settings state
  const [newUsername, setNewUsername] = useState<string>("");
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );

  // Pending avatar upload state (for preview before save)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  // Update profile data when loaded
  useEffect(() => {
    if (profile) {
      const lang = profile.language === "ko" ? "ko" : "en";
      setProfileData({
        avatarUrl: profile.avatarUrl || "",
        bio: profile.bio || "",
        language: lang,
        timezone: profile.timezone || "Asia/Seoul",
      });
    }
  }, [profile]);

  // Update preferences data when loaded
  useEffect(() => {
    if (preferences) {
      setPreferencesData({
        enableNotifications: preferences.enableNotifications ?? true,
        emailNotifications: preferences.emailNotifications ?? false,
        practiceReminders: preferences.practiceReminders ?? true,
      });
    }
  }, [preferences]);

  // Update language preferences data when loaded
  useEffect(() => {
    if (langPrefs) {
      setLangPrefsData({
        baseLanguage: langPrefs.baseLanguage || 'ko',
        learningLanguage: langPrefs.learningLanguage || 'en',
      });
    }
  }, [langPrefs]);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/profile"] });
      toast({
        title: t("settings.profileSaved"),
        description: t("settings.profileSavedDesc"),
      });
    },
    onError: (error) => {
      console.error("Error updating profile:", error);
      toast({
        title: t("settings.error"),
        description: t("settings.errorSavingProfile"),
        variant: "destructive",
      });
    },
  });

  // Update preferences mutation
  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/me/preferences", {
        method: "PUT",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/preferences"] });
      toast({
        title: t("settings.settingsSaved"),
        description: t("settings.settingsSavedDesc"),
      });
    },
    onError: (error) => {
      console.error("Error updating preferences:", error);
      toast({
        title: t("settings.error"),
        description: t("settings.errorSavingSettings"),
        variant: "destructive",
      });
    },
  });

  // Update language learning preferences mutation
  const updateLangPrefsMutation = useMutation({
    mutationFn: async (data: { baseLanguage: string; learningLanguage: string }) => {
      return apiRequest("/api/me/language", {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/language"] });
      toast({
        title: t("settings.languageSettingsSaved"),
        description: t("settings.languageSettingsSavedDesc"),
      });
    },
    onError: (error) => {
      console.error("Error updating language preferences:", error);
      toast({
        title: t("settings.error"),
        description: t("settings.errorSavingLanguageSettings"),
        variant: "destructive",
      });
    },
  });

  // Change username mutation
  const changeUsernameMutation = useMutation({
    mutationFn: async (username: string) => {
      return apiRequest("/api/auth/change-username", {
        method: "PUT",
        json: { username },
      });
    },
    onSuccess: () => {
      toast({
        title: t("settings.usernameChanged"),
        description: t("settings.usernameChangedDesc"),
      });
      setNewUsername("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.error"),
        description: error.message || t("settings.errorChangingUsername"),
        variant: "destructive",
      });
    },
  });

  // Delete account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/auth/account", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: t("settings.accountDeleted"),
        description: t("settings.accountDeletedDesc"),
      });

      setTimeout(() => {
        logout();
      }, 1500);
    },
    onError: (error: any) => {
      toast({
        title: t("settings.error"),
        description: error.message || t("settings.errorDeletingAccount"),
        variant: "destructive",
      });
    },
  });

  // Username availability check
  useEffect(() => {
    if (!newUsername || newUsername === user?.username) {
      setUsernameAvailable(null);
      return;
    }

    if (newUsername.length < 3 || newUsername.length > 30) {
      setUsernameAvailable(null);
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingUsername(true);
      try {
        const response = await fetch(
          `/api/auth/check-username?username=${encodeURIComponent(newUsername)}`,
        );
        const data = await response.json();
        setUsernameAvailable(data.available);
      } catch (error) {
        console.error("Error checking username:", error);
        setUsernameAvailable(null);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [newUsername, user?.username]);

  const handleProfileInputChange = (field: string, value: string) => {
    setProfileData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (field === "language" && (value === "en" || value === "ko")) {
      setLanguage(value);
    }
  };

  const handlePreferencesInputChange = (
    field: string,
    value: boolean,
  ) => {
    setPreferencesData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };


  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: t("settings.invalidFileType"),
        description: t("settings.invalidFileTypeDesc"),
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("settings.fileTooLarge"),
        description: t("settings.fileTooLargeDesc"),
        variant: "destructive",
      });
      return;
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setPendingAvatarFile(file);
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(previewUrl);
  };

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  const saveProfile = () => {
    const cleanedData: any = {
      language: profileData.language,
      timezone: profileData.timezone,
    };

    if (profileData.bio && profileData.bio.trim()) {
      cleanedData.bio = profileData.bio.trim();
    }

    if (profileData.avatarUrl && profileData.avatarUrl.trim()) {
      cleanedData.avatarUrl = profileData.avatarUrl.trim();
    }

    updateProfileMutation.mutate(cleanedData);
  };

  const savePreferences = () => {
    const serverPreferences = {
      emailNotifications: preferencesData.emailNotifications,
      practiceReminders: preferencesData.practiceReminders,
    };
    
    updatePreferencesMutation.mutate(serverPreferences);
  };

  const saveAllSettings = async () => {
    let avatarUrl = profileData.avatarUrl;
    
    if (pendingAvatarFile) {
      try {
        const formData = new FormData();
        formData.append("avatar", pendingAvatarFile);
        
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch("/api/me/profile/avatar", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {},
        });
        
        if (!response.ok) {
          throw new Error("Failed to upload avatar");
        }
        
        const result = await response.json();
        avatarUrl = result.avatarUrl;
        
        setProfileData((prev) => ({ ...prev, avatarUrl }));
        setPendingAvatarFile(null);
        if (avatarPreviewUrl) {
          URL.revokeObjectURL(avatarPreviewUrl);
          setAvatarPreviewUrl(null);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/me/profile"] });
      } catch (error) {
        console.error("Error uploading avatar:", error);
        toast({
          title: t("settings.error"),
          description: t("settings.errorUploadingAvatar"),
          variant: "destructive",
        });
        return;
      }
    }
    
    const cleanedData: any = {
      language: profileData.language,
      timezone: profileData.timezone,
    };

    if (profileData.bio && profileData.bio.trim()) {
      cleanedData.bio = profileData.bio.trim();
    }

    if (avatarUrl && avatarUrl.trim()) {
      cleanedData.avatarUrl = avatarUrl.trim();
    }

    updateProfileMutation.mutate(cleanedData);
    savePreferences();
    
    // Save language learning preferences
    updateLangPrefsMutation.mutate(langPrefsData);
  };

  const handleUsernameChange = () => {
    if (!newUsername || newUsername === user?.username) {
      toast({
        title: t("settings.error"),
        description: t("settings.enterNewUsername"),
        variant: "destructive",
      });
      return;
    }

    if (usernameAvailable === false) {
      toast({
        title: t("settings.error"),
        description: t("settings.usernameUnavailable"),
        variant: "destructive",
      });
      return;
    }

    changeUsernameMutation.mutate(newUsername);
  };

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loadingProfile || loadingPreferences || loadingLangPrefs) {
    return (
      <Layout>
        <div className="container mx-auto p-4 max-w-3xl mt-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/4"></div>
            <div className="space-y-3">
              <div className="h-4 bg-muted rounded"></div>
              <div className="h-4 bg-muted rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto p-4 max-w-3xl mt-4">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">{t("settings.title")}</h2>
          <p className="text-muted-foreground">{t("settings.subtitle")}</p>
        </div>

        <div className="grid gap-6">
          {/* Subscription & Billing Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                {t("settings.subscriptionTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.subscriptionDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current Plan Display */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">{t("settings.currentPlan")}</Label>
                  <p className="text-lg font-semibold mt-1">
                    {getPlanTypeDisplay(userPlanType)}
                  </p>
                </div>

                {/* Expiry Date */}
                <div>
                  <Label className="text-sm font-medium">{t("settings.expiryDate")}</Label>
                  <p className="text-base mt-1">
                    {userPlanExpiresAt ? (
                      <span className="text-muted-foreground">
                        {t("settings.expiryDateValue", { date: formatExpiryDate(userPlanExpiresAt) || '' })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("settings.noExpiry")}</span>
                    )}
                  </p>
                </div>
              </div>

              {/* View Plan Details Button - Temporarily hidden during service maintenance */}

              {/* Non-auto-renewal Note */}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                {t("settings.nonAutoRenewalNote")}
              </p>

              {/* Payment History Link */}
              <div className="pt-2">
                <Dialog open={isPaymentHistoryOpen} onOpenChange={setIsPaymentHistoryOpen}>
                  <DialogTrigger asChild>
                    <button className="text-sm text-primary hover:underline">
                      {t("settings.viewPaymentHistory")}
                    </button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>{t("settings.paymentHistoryTitle")}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                      {paymentHistory.length > 0 ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-4 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                            <span>{t("settings.paymentDate")}</span>
                            <span>{t("settings.paymentPlan")}</span>
                            <span>{t("settings.paymentAmount")}</span>
                            <span>{t("settings.paymentStatus")}</span>
                          </div>
                          {paymentHistory.map((payment, idx) => (
                            <div key={idx} className="grid grid-cols-4 gap-2 text-sm py-2 border-b border-muted">
                              <span>{payment.date}</span>
                              <span>{payment.plan}</span>
                              <span>{payment.amount}</span>
                              <span className={
                                payment.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                                payment.status === 'failed' ? 'text-destructive' : 'text-yellow-600 dark:text-yellow-400'
                              }>
                                {payment.status === 'completed' ? t("settings.paymentCompleted") :
                                 payment.status === 'failed' ? t("settings.paymentFailed") : t("settings.paymentPending")}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">
                          {t("settings.noPaymentHistory")}
                        </p>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
          {/* Account Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="h-5 w-5" />
                {t("settings.accountSettings")}
              </CardTitle>
              <CardDescription>
                {t("settings.accountSettingsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Email Display */}
              <div className="space-y-2">
                <Label>{t("settings.email")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={user?.email || ""}
                    disabled
                    className="flex-1 bg-muted"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.emailConnectedGoogle")}
                </p>
              </div>

              {/* Username */}
              <div className="space-y-2">
                <Label>{t("settings.currentUsername")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={user?.username || ""}
                    disabled
                    className="flex-1 bg-muted"
                  />
                </div>
              </div>

              {/* Change Username */}
              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="newUsername">
                  {t("settings.changeUsername")}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="newUsername"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder={t("settings.newUsername")}
                      disabled={changeUsernameMutation.isPending}
                      data-testid="input-new-username"
                    />
                    {isCheckingUsername && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!isCheckingUsername &&
                      usernameAvailable === true &&
                      newUsername && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        </div>
                      )}
                  </div>
                  <Button
                    onClick={handleUsernameChange}
                    disabled={
                      changeUsernameMutation.isPending ||
                      !newUsername ||
                      newUsername === user?.username ||
                      usernameAvailable !== true ||
                      isCheckingUsername
                    }
                    data-testid="button-change-username"
                  >
                    {changeUsernameMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("settings.change")
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.usernameRules")}
                </p>
                {usernameAvailable === false && newUsername && (
                  <p className="text-sm text-destructive">
                    {t("settings.usernameUnavailable")}
                  </p>
                )}
              </div>

              {/* Profile Picture */}
              <div className="border-t pt-4">
                <Label className="text-sm font-medium">
                  {t("settings.profilePicture")}
                </Label>
                <div className="flex items-center gap-4 mt-2">
                  <Avatar className="h-16 w-16">
                    <AvatarImage
                      src={avatarPreviewUrl || profileData.avatarUrl}
                      alt="Profile picture"
                    />
                    <AvatarFallback className="text-lg">
                      {getInitials(user?.username)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      id="avatar-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        document.getElementById("avatar-upload")?.click()
                      }
                      disabled={updateProfileMutation.isPending}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {t("settings.uploadImage")}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Bio */}
              <div>
                <Label htmlFor="bio">{t("settings.bio")}</Label>
                <Textarea
                  id="bio"
                  value={profileData.bio}
                  onChange={(e) =>
                    handleProfileInputChange("bio", e.target.value)
                  }
                  placeholder={t("settings.bioPlaceholder")}
                  className="min-h-[80px] mt-2"
                />
              </div>
            </CardContent>
          </Card>

          {/* Service Settings (Merged Localization + Language Learning) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5" />
                {t("settings.serviceSettings")}
              </CardTitle>
              <CardDescription>
                {t("settings.serviceSettingsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Timezone */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="timezone" className="text-sm">{t("settings.timezone")}</Label>
                  <Select
                    value={profileData.timezone}
                    onValueChange={(value) =>
                      handleProfileInputChange("timezone", value)
                    }
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder={t("settings.selectTimezone")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Seoul">Seoul (UTC+9)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo (UTC+9)</SelectItem>
                      <SelectItem value="America/New_York">New York (UTC-5)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Los Angeles (UTC-8)</SelectItem>
                      <SelectItem value="Europe/London">London (UTC+0)</SelectItem>
                      <SelectItem value="Europe/Paris">Paris (UTC+1)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* AI Language Settings */}
              <div className="border-t pt-4">
                <span className="text-sm font-medium mb-3 block">AI Language Settings</span>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure how AI understands and assists you with language
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="baseLanguage" className="text-sm">
                      {t("settings.baseLanguage")}
                    </Label>
                    <Select
                      value={langPrefsData.baseLanguage}
                      onValueChange={(value) =>
                        setLangPrefsData((prev) => ({ ...prev, baseLanguage: value }))
                      }
                    >
                      <SelectTrigger data-testid="select-base-language">
                        <SelectValue placeholder={t("settings.selectLanguage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.name} ({lang.nameEn})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="learningLanguage" className="text-sm">
                      {t("settings.learningLanguage")}
                    </Label>
                    <Select
                      value={langPrefsData.learningLanguage}
                      onValueChange={(value) =>
                        setLangPrefsData((prev) => ({ ...prev, learningLanguage: value }))
                      }
                    >
                      <SelectTrigger data-testid="select-learning-language">
                        <SelectValue placeholder={t("settings.selectLanguage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.name} ({lang.nameEn})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {langPrefsData.baseLanguage === langPrefsData.learningLanguage && (
                  <p className="text-sm text-brand dark:text-brand mt-2">
                    {t("settings.sameLanguageWarning")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-between items-center">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="text-destructive border-destructive/50 hover:bg-destructive/10"
                  data-testid="button-delete-account-trigger"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t("settings.deleteAccount")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    {t("settings.deleteConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <p className="font-medium text-foreground">
                      {t("settings.deleteConfirmDesc")}
                    </p>
                    <p>{t("settings.deleteConfirmDesc2")}</p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>{t("settings.deleteConfirmItem1")}</li>
                      <li>{t("settings.deleteConfirmItem2")}</li>
                      <li>{t("settings.deleteConfirmItem3")}</li>
                      <li>{t("settings.deleteConfirmItem4")}</li>
                      <li>{t("settings.deleteConfirmItem5")}</li>
                    </ul>
                    <p className="text-destructive font-medium">
                      {t("settings.deleteConfirmWarning")}
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">
                    {t("settings.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteAccountMutation.mutate()}
                    disabled={deleteAccountMutation.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    {deleteAccountMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("settings.deleting")}
                      </>
                    ) : (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("settings.yesDeleteMyAccount")}
                      </>
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              onClick={saveAllSettings}
              disabled={
                updateProfileMutation.isPending ||
                updatePreferencesMutation.isPending
              }
              className="min-w-[180px]"
              size="lg"
            >
              {updateProfileMutation.isPending ||
              updatePreferencesMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.saving")}
                </>
              ) : (
                t("settings.saveAllChanges")
              )}
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
