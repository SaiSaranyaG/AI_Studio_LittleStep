import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  SpaceProfile,
  PlantAdoption,
  CareTask,
  HealthDiagnostic,
  AirQualityBaseline,
  AirTimelineEntry,
  PointTransaction,
  RewardItem,
  UserSustainabilityPreferences,
  UserPlantPreferences,
  PlantJourneyMilestone,
} from '../types';
import { trackAnalyticsEvent } from './analyticsService';

export type DataMode = 'mock' | 'cloud';

export const CURRENT_DATA_MODE: DataMode =
  (import.meta.env.VITE_DATA_MODE as DataMode) === 'mock' ? 'mock' : 'cloud';

/**
 * LittleStep Data Repository Layer
 * Manages persistence between React Context and Cloud Firestore subcollections & Google Cloud Analytics Tables.
 */

// Helper to get user subcollection path
export const getUserSubcollectionRef = (uid: string, subcollection: string) => {
  return collection(db, 'users', uid, subcollection);
};

export const getUserDocRef = (uid: string, subcollection: string, docId: string) => {
  return doc(db, 'users', uid, subcollection, docId);
};

// Helper to sync record to Google Cloud backend tables for analytics
async function syncToCloudBackend(tableName: string, record: Record<string, unknown>) {
  try {
    fetch(`/api/cloud/tables/${tableName}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {});
  } catch {
    // Non-blocking background sync
  }
}

// --------------------------------------------------------------------------
// SPACES REPOSITORY (Google Cloud Table: spaces_stored)
// --------------------------------------------------------------------------
export async function saveSpaceToCloud(uid: string, space: SpaceProfile): Promise<void> {
  if (!uid || !space.id) return;
  try {
    const spaceData = {
      ...space,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    };

    // 1. User isolated subcollection
    const spaceRef = getUserDocRef(uid, 'spaces', space.id);
    await setDoc(spaceRef, spaceData, { merge: true });

    // 2. Google Cloud table for spaces (analytics & recovery)
    const globalSpaceRef = doc(db, 'spaces', space.id);
    await setDoc(globalSpaceRef, spaceData, { merge: true }).catch(() => {});

    // 3. Sync to Google Cloud analytics pipeline
    syncToCloudBackend('spaces_stored', {
      space_id: space.id,
      user_id: uid,
      space_name: space.name,
      space_type: space.spaceType,
      usable_area_sq_ft: space.usableAreaSqFt,
      length_ft: space.lengthFt,
      width_ft: space.widthFt,
      plant_capacity_estimate: space.plantCapacityEstimate,
      zones_json: JSON.stringify(space.zones || []),
      created_at: space.lastScannedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      data_source: 'cloud',
    });

    // 4. Stream telemetry event
    trackAnalyticsEvent({
      eventType: 'space_stored',
      userId: uid,
      entityId: space.id,
      entityType: 'space',
      metadata: {
        spaceName: space.name,
        spaceType: space.spaceType,
        usableAreaSqFt: space.usableAreaSqFt,
        zonesCount: space.zones?.length || 0,
      },
    });
  } catch (error) {
    console.error('[DataService] Failed to save space to Firestore:', error);
    throw error;
  }
}

export async function deleteSpaceFromCloud(uid: string, spaceId: string): Promise<void> {
  if (!uid || !spaceId) return;
  try {
    const spaceRef = getUserDocRef(uid, 'spaces', spaceId);
    await deleteDoc(spaceRef);
    const globalSpaceRef = doc(db, 'spaces', spaceId);
    await deleteDoc(globalSpaceRef).catch(() => {});
  } catch (error) {
    console.error('[DataService] Failed to delete space from Firestore:', error);
    throw error;
  }
}

export function subscribeToUserSpaces(
  uid: string,
  onData: (spaces: SpaceProfile[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const spacesRef = getUserSubcollectionRef(uid, 'spaces');
    return onSnapshot(
      spacesRef,
      (snapshot) => {
        const spaces: SpaceProfile[] = [];
        snapshot.forEach((docSnap) => {
          spaces.push(docSnap.data() as SpaceProfile);
        });
        onData(spaces);
      },
      (error) => {
        console.error('[DataService] Error subscribing to spaces:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish spaces snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// ADOPTIONS REPOSITORY (Google Cloud Table: plants_chosen)
// --------------------------------------------------------------------------
export async function saveAdoptionToCloud(uid: string, adoption: PlantAdoption): Promise<void> {
  if (!uid || !adoption.id) return;
  try {
    const adoptionData = {
      ...adoption,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    };

    // 1. User isolated subcollection
    const adoptionRef = getUserDocRef(uid, 'adoptions', adoption.id);
    await setDoc(adoptionRef, adoptionData, { merge: true });

    // 2. Google Cloud table for plants chosen
    const globalPlantRef = doc(db, 'plants_chosen', adoption.id);
    await setDoc(globalPlantRef, adoptionData, { merge: true }).catch(() => {});

    // 3. Automatically sync any reached milestones for this plant
    if (adoption.milestones && Array.isArray(adoption.milestones)) {
      for (const m of adoption.milestones) {
        if (m.isUnlocked || m.isCompleted) {
          saveMilestoneToCloud(uid, m, adoption.nickname || adoption.speciesId, adoption.id).catch(() => {});
        }
      }
    }

    // 4. Sync to Google Cloud analytics pipeline
    syncToCloudBackend('plants_chosen', {
      adoption_id: adoption.id,
      user_id: uid,
      species_id: adoption.speciesId,
      common_name: adoption.nickname || adoption.speciesId,
      nickname: adoption.nickname,
      space_id: adoption.spaceId,
      zone_id: adoption.zoneId,
      health_status: adoption.healthStatus,
      streak_days: adoption.streakDays || 1,
      total_survival_days: adoption.totalSurvivalDays || 1,
      water_frequency_days: 7,
      adopted_at: adoption.adoptedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      data_source: 'cloud',
    });

    // 5. Stream telemetry event
    trackAnalyticsEvent({
      eventType: 'plant_chosen',
      userId: uid,
      entityId: adoption.id,
      entityType: 'plant',
      metadata: {
        speciesId: adoption.speciesId,
        nickname: adoption.nickname,
        spaceId: adoption.spaceId,
        healthStatus: adoption.healthStatus,
        streakDays: adoption.streakDays,
      },
    });
  } catch (error) {
    console.error('[DataService] Failed to save adoption to Firestore:', error);
    throw error;
  }
}

export async function deleteAdoptionFromCloud(uid: string, adoptionId: string): Promise<void> {
  if (!uid || !adoptionId) return;
  try {
    const adoptionRef = getUserDocRef(uid, 'adoptions', adoptionId);
    await deleteDoc(adoptionRef);
    const globalPlantRef = doc(db, 'plants_chosen', adoptionId);
    await deleteDoc(globalPlantRef).catch(() => {});
  } catch (error) {
    console.error('[DataService] Failed to delete adoption from Firestore:', error);
    throw error;
  }
}

export function subscribeToUserAdoptions(
  uid: string,
  onData: (adoptions: PlantAdoption[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const adoptionsRef = getUserSubcollectionRef(uid, 'adoptions');
    return onSnapshot(
      adoptionsRef,
      (snapshot) => {
        const adoptions: PlantAdoption[] = [];
        snapshot.forEach((docSnap) => {
          adoptions.push(docSnap.data() as PlantAdoption);
        });
        onData(adoptions);
      },
      (error) => {
        console.error('[DataService] Error subscribing to adoptions:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish adoptions snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// MILESTONES REPOSITORY (Google Cloud Table: milestones_reached)
// --------------------------------------------------------------------------
export async function saveMilestoneToCloud(
  uid: string,
  milestone: PlantJourneyMilestone,
  plantNickname?: string,
  adoptionId?: string
): Promise<void> {
  if (!uid || !milestone.title) return;
  try {
    const milestoneId = `milestone_${uid}_${adoptionId || 'general'}_day${milestone.day}`;
    const milestoneData = {
      id: milestoneId,
      ...milestone,
      adoptionId: adoptionId || null,
      userId: uid,
      plantName: plantNickname || 'Plant Companion',
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    };

    // 1. User subcollection
    const userMilestoneRef = getUserDocRef(uid, 'milestones', milestoneId);
    await setDoc(userMilestoneRef, milestoneData, { merge: true });

    // 2. Google Cloud table for milestones reached
    const globalMilestoneRef = doc(db, 'milestones_reached', milestoneId);
    await setDoc(globalMilestoneRef, milestoneData, { merge: true }).catch(() => {});

    // 3. Sync to Google Cloud analytics pipeline
    syncToCloudBackend('milestones_reached', {
      milestone_id: milestoneId,
      user_id: uid,
      adoption_id: adoptionId || null,
      plant_name: plantNickname || 'Plant Companion',
      milestone_key: `day_${milestone.day}`,
      title: milestone.title,
      description: milestone.description || '',
      points_awarded: milestone.pointsAwarded || 20,
      category: 'growth',
      achieved_at: milestone.completedAt || new Date().toISOString(),
      data_source: 'cloud',
    });

    // 4. Stream telemetry event
    trackAnalyticsEvent({
      eventType: 'milestone_reached',
      userId: uid,
      entityId: milestoneId,
      entityType: 'milestone',
      metadata: {
        title: milestone.title,
        pointsAwarded: milestone.pointsAwarded,
        plantName: plantNickname,
        day: milestone.day,
      },
    });
  } catch (error) {
    console.error('[DataService] Failed to save milestone to Firestore:', error);
  }
}

// --------------------------------------------------------------------------
// CARE TASKS REPOSITORY
// --------------------------------------------------------------------------
export async function saveCareTaskToCloud(uid: string, task: CareTask): Promise<void> {
  if (!uid || !task.id) return;
  try {
    const taskRef = getUserDocRef(uid, 'care_tasks', task.id);
    await setDoc(taskRef, {
      ...task,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    }, { merge: true });
  } catch (error) {
    console.error('[DataService] Failed to save care task to Firestore:', error);
    throw error;
  }
}

export function subscribeToUserCareTasks(
  uid: string,
  onData: (tasks: CareTask[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const tasksRef = getUserSubcollectionRef(uid, 'care_tasks');
    return onSnapshot(
      tasksRef,
      (snapshot) => {
        const tasks: CareTask[] = [];
        snapshot.forEach((docSnap) => {
          tasks.push(docSnap.data() as CareTask);
        });
        onData(tasks);
      },
      (error) => {
        console.error('[DataService] Error subscribing to care tasks:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish care tasks snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// HEALTH DIAGNOSTICS REPOSITORY
// --------------------------------------------------------------------------
export async function saveDiagnosticToCloud(uid: string, diag: HealthDiagnostic): Promise<void> {
  if (!uid || !diag.id) return;
  try {
    const diagRef = getUserDocRef(uid, 'diagnostics', diag.id);
    await setDoc(diagRef, {
      ...diag,
      userId: uid,
      savedAt: new Date().toISOString(),
      dataSource: 'cloud',
    }, { merge: true });
  } catch (error) {
    console.error('[DataService] Failed to save diagnostic to Firestore:', error);
    throw error;
  }
}

export async function deleteDiagnosticFromCloud(uid: string, diagId: string): Promise<void> {
  if (!uid || !diagId) return;
  try {
    const diagRef = getUserDocRef(uid, 'diagnostics', diagId);
    await deleteDoc(diagRef);
  } catch (error) {
    console.error('[DataService] Failed to delete diagnostic from Firestore:', error);
    throw error;
  }
}

export function subscribeToUserDiagnostics(
  uid: string,
  onData: (diagnostics: HealthDiagnostic[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const diagRef = getUserSubcollectionRef(uid, 'diagnostics');
    return onSnapshot(
      diagRef,
      (snapshot) => {
        const diags: HealthDiagnostic[] = [];
        snapshot.forEach((docSnap) => {
          diags.push(docSnap.data() as HealthDiagnostic);
        });
        onData(diags);
      },
      (error) => {
        console.error('[DataService] Error subscribing to diagnostics:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish diagnostics snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// AIR BASELINE REPOSITORY
// --------------------------------------------------------------------------
export async function saveAirBaselineToCloud(uid: string, baseline: AirQualityBaseline): Promise<void> {
  if (!uid || !baseline.id) return;
  try {
    const baselineRef = getUserDocRef(uid, 'air_baselines', baseline.id);
    await setDoc(baselineRef, {
      ...baseline,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    }, { merge: true });
  } catch (error) {
    console.error('[DataService] Failed to save air baseline to Firestore:', error);
    throw error;
  }
}

export function subscribeToUserAirBaseline(
  uid: string,
  onData: (baseline: AirQualityBaseline | null) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const baselinesRef = getUserSubcollectionRef(uid, 'air_baselines');
    return onSnapshot(
      baselinesRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const firstDoc = snapshot.docs[0].data() as AirQualityBaseline;
          onData(firstDoc);
        } else {
          onData(null);
        }
      },
      (error) => {
        console.error('[DataService] Error subscribing to air baseline:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish air baseline snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// AIR TIMELINE REPOSITORY
// --------------------------------------------------------------------------
export async function saveAirTimelineEntryToCloud(uid: string, entry: AirTimelineEntry): Promise<void> {
  if (!uid || !entry.id) return;
  try {
    const entryRef = getUserDocRef(uid, 'air_timeline', entry.id);
    await setDoc(
      entryRef,
      {
        ...entry,
        userId: uid,
        updatedAt: new Date().toISOString(),
        dataSource: 'cloud',
      },
      { merge: true }
    );
  } catch (error) {
    console.error('[DataService] Failed to save air timeline entry to Firestore:', error);
  }
}

export function subscribeToUserAirTimeline(
  uid: string,
  onData: (timeline: AirTimelineEntry[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const timelineRef = getUserSubcollectionRef(uid, 'air_timeline');
    return onSnapshot(
      timelineRef,
      (snapshot) => {
        const list: AirTimelineEntry[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as AirTimelineEntry);
        });
        if (list.length > 0) {
          list.sort((a, b) => a.dayNumber - b.dayNumber);
          onData(list);
        }
      },
      (error) => {
        console.error('[DataService] Error subscribing to air timeline:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish air timeline snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// POINTS TRANSACTIONS REPOSITORY (Google Cloud Table: points_scored)
// --------------------------------------------------------------------------
export async function savePointTransactionToCloud(uid: string, tx: PointTransaction): Promise<void> {
  if (!uid || !tx.id) return;
  try {
    const txData = {
      ...tx,
      userId: uid,
      recordedAt: new Date().toISOString(),
      dataSource: 'cloud',
    };

    // 1. User subcollection
    const txRef = getUserDocRef(uid, 'points_transactions', tx.id);
    await setDoc(txRef, txData, { merge: true });

    // 2. Google Cloud table for points scored
    const globalPointsRef = doc(db, 'points_scored', tx.id);
    await setDoc(globalPointsRef, txData, { merge: true }).catch(() => {});

    // 3. Sync to Google Cloud analytics pipeline
    syncToCloudBackend('points_scored', {
      transaction_id: tx.id,
      user_id: uid,
      action_type: tx.actionType,
      points: tx.points,
      reason: tx.description,
      recorded_at: tx.timestamp || new Date().toISOString(),
      verified: tx.verifiedServerSide ?? true,
      data_source: 'cloud',
    });

    // 4. Stream telemetry event
    trackAnalyticsEvent({
      eventType: 'points_scored',
      userId: uid,
      entityId: tx.id,
      entityType: 'points',
      metadata: {
        actionType: tx.actionType,
        amount: tx.points,
        description: tx.description,
      },
    });
  } catch (error) {
    console.error('[DataService] Failed to save point transaction to Firestore:', error);
    throw error;
  }
}

export function subscribeToUserPointsTransactions(
  uid: string,
  onData: (transactions: PointTransaction[]) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const txRef = getUserSubcollectionRef(uid, 'points_transactions');
    return onSnapshot(
      txRef,
      (snapshot) => {
        const list: PointTransaction[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as PointTransaction);
        });
        onData(list);
      },
      (error) => {
        console.error('[DataService] Error subscribing to points transactions:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish points transactions snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// REWARD REDEMPTIONS REPOSITORY (Google Cloud Table: rewards_redeemed)
// --------------------------------------------------------------------------
export async function saveRewardRedemptionToCloud(uid: string, reward: RewardItem): Promise<void> {
  if (!uid || !reward.id) return;
  try {
    const redemptionId = `redemption_${uid}_${reward.id}`;
    const rewardData = {
      id: redemptionId,
      rewardId: reward.id,
      title: reward.title,
      category: reward.category,
      pointsCost: reward.pointsCost,
      isRedeemed: true,
      redeemedAt: reward.redeemedAt || new Date().toISOString(),
      userId: uid,
      dataSource: 'cloud',
    };

    // 1. User subcollection
    const rewardRef = getUserDocRef(uid, 'reward_redemptions', reward.id);
    await setDoc(rewardRef, rewardData, { merge: true });

    // 2. Google Cloud table for rewards redeemed
    const globalRewardRef = doc(db, 'rewards_redeemed', redemptionId);
    await setDoc(globalRewardRef, rewardData, { merge: true }).catch(() => {});

    // 3. Sync to Google Cloud analytics pipeline
    syncToCloudBackend('rewards_redeemed', {
      redemption_id: redemptionId,
      user_id: uid,
      reward_id: reward.id,
      reward_title: reward.title,
      category: reward.category,
      points_cost: reward.pointsCost,
      is_redeemed: true,
      redeemed_at: reward.redeemedAt || new Date().toISOString(),
      data_source: 'cloud',
    });

    // 4. Stream telemetry event
    trackAnalyticsEvent({
      eventType: 'reward_redeemed',
      userId: uid,
      entityId: reward.id,
      entityType: 'reward',
      metadata: {
        rewardTitle: reward.title,
        pointsCost: reward.pointsCost,
        category: reward.category,
      },
    });
  } catch (error) {
    console.error('[DataService] Failed to save reward redemption to Firestore:', error);
    throw error;
  }
}

export function subscribeToUserRewardRedemptions(
  uid: string,
  onData: (redemptions: Record<string, boolean>) => void
): Unsubscribe | null {
  if (!uid) return null;
  try {
    const rewardsRef = getUserSubcollectionRef(uid, 'reward_redemptions');
    return onSnapshot(
      rewardsRef,
      (snapshot) => {
        const redeemedMap: Record<string, boolean> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.rewardId) {
            redeemedMap[data.rewardId] = true;
          }
        });
        onData(redeemedMap);
      },
      (error) => {
        console.error('[DataService] Error subscribing to reward redemptions:', error);
      }
    );
  } catch (err) {
    console.error('[DataService] Could not establish rewards snapshot:', err);
    return null;
  }
}

// --------------------------------------------------------------------------
// GOOGLE CLOUD TABLES QUERY ACCESS & ANALYTICS FETCH
// --------------------------------------------------------------------------
export interface UserCloudTablesExport {
  spaces: SpaceProfile[];
  plantsChosen: PlantAdoption[];
  milestonesReached: PlantJourneyMilestone[];
  rewardsRedeemed: Array<{ rewardId: string; title: string; pointsCost: number; redeemedAt: string }>;
  pointsScored: PointTransaction[];
}

export async function fetchUserCloudTables(uid: string): Promise<UserCloudTablesExport> {
  const result: UserCloudTablesExport = {
    spaces: [],
    plantsChosen: [],
    milestonesReached: [],
    rewardsRedeemed: [],
    pointsScored: [],
  };
  if (!uid) return result;

  try {
    const [spacesSnap, plantsSnap, milestonesSnap, rewardsSnap, pointsSnap] = await Promise.all([
      getDocs(getUserSubcollectionRef(uid, 'spaces')),
      getDocs(getUserSubcollectionRef(uid, 'adoptions')),
      getDocs(getUserSubcollectionRef(uid, 'milestones')),
      getDocs(getUserSubcollectionRef(uid, 'reward_redemptions')),
      getDocs(getUserSubcollectionRef(uid, 'points_transactions')),
    ]);

    spacesSnap.forEach((d) => result.spaces.push(d.data() as SpaceProfile));
    plantsSnap.forEach((d) => result.plantsChosen.push(d.data() as PlantAdoption));
    milestonesSnap.forEach((d) => result.milestonesReached.push(d.data() as PlantJourneyMilestone));
    rewardsSnap.forEach((d) => result.rewardsRedeemed.push(d.data() as any));
    pointsSnap.forEach((d) => result.pointsScored.push(d.data() as PointTransaction));
  } catch (err) {
    console.warn('[DataService] Failed to query user cloud tables:', err);
  }

  return result;
}

// --------------------------------------------------------------------------
// SUSTAINABILITY & PLANT PREFERENCES REPOSITORY (BUG-15)
// --------------------------------------------------------------------------
export async function savePreferencesToCloud(
  uid: string,
  prefs: UserSustainabilityPreferences
): Promise<void> {
  if (!uid) return;
  try {
    const prefsRef = getUserDocRef(uid, 'preferences', 'sustainability');
    await setDoc(prefsRef, {
      ...prefs,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    }, { merge: true });
  } catch (error) {
    console.error('[DataService] Failed to save preferences to Firestore:', error);
    throw error;
  }
}

export async function loadPreferencesFromCloud(
  uid: string
): Promise<UserSustainabilityPreferences | null> {
  if (!uid) return null;
  try {
    const prefsRef = getUserDocRef(uid, 'preferences', 'sustainability');
    const snap = await getDoc(prefsRef);
    if (snap.exists()) {
      return snap.data() as UserSustainabilityPreferences;
    }
  } catch (error) {
    console.error('[DataService] Failed to load preferences from Firestore:', error);
  }
  return null;
}

export async function savePlantPreferencesToCloud(
  uid: string,
  prefs: UserPlantPreferences
): Promise<void> {
  if (!uid) return;
  try {
    const prefsRef = getUserDocRef(uid, 'preferences', 'plant');
    await setDoc(prefsRef, {
      ...prefs,
      userId: uid,
      updatedAt: new Date().toISOString(),
      dataSource: 'cloud',
    }, { merge: true });
  } catch (error) {
    console.error('[DataService] Failed to save plant preferences to Firestore:', error);
    throw error;
  }
}

export async function loadPlantPreferencesFromCloud(
  uid: string
): Promise<UserPlantPreferences | null> {
  if (!uid) return null;
  try {
    const prefsRef = getUserDocRef(uid, 'preferences', 'plant');
    const snap = await getDoc(prefsRef);
    if (snap.exists()) {
      return snap.data() as UserPlantPreferences;
    }
  } catch (error) {
    console.error('[DataService] Failed to load plant preferences from Firestore:', error);
  }
  return null;
}
