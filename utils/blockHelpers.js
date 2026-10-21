// Blocking is deliberately one-sided and invisible to the person who was
// blocked. Two things make that work:
//
//   1. The blocker keeps a snapshot of their own profile from the moment they
//      blocked someone, so profile edits afterwards aren't visible to them.
//   2. The block lists themselves are internal bookkeeping and must never
//      reach a client (otherwise the blocked person could just read the API
//      response and find out).
const clearInternalFields = (participant) => {
    if (typeof participant.set === "function") {
        participant.set("blockedUsers", undefined);
        participant.set("blockedSnapshots", undefined);
        return;
    }

    delete participant.blockedUsers;
    delete participant.blockedSnapshots;
};

const applyBlockSnapshot = (participant, viewerId) => {
    if (!participant || !viewerId) {
        return participant;
    }

    const snapshots = participant.blockedSnapshots;

    const snapshot =
        snapshots && typeof snapshots.find === "function"
            ? snapshots.find(
                  (entry) =>
                      entry &&
                      entry.user &&
                      entry.user.toString() === viewerId.toString()
              )
            : null;

    if (snapshot) {
        // Empty strings are meaningful here ("no photo", "no bio") — the
        // snapshot must win even when it is blank.
        if (snapshot.name !== undefined) {
            participant.name = snapshot.name;
        }

        if (snapshot.username !== undefined) {
            participant.username = snapshot.username;
        }

        if (snapshot.profilePicture !== undefined) {
            participant.profilePicture = snapshot.profilePicture;
        }

        if (snapshot.bio !== undefined) {
            participant.bio = snapshot.bio;
        }

        // Freeze presence as well, so going online/offline isn't a tell.
        // The client derives both "online" and "presence hidden" from these.
        participant.isOnline = false;
        participant.lastSeen = snapshot.lastSeen || null;
        participant.onlineStatus = false;
        participant.lastSeenVisibility = "nobody";
    }

    clearInternalFields(participant);

    return participant;
};

const applyBlockSnapshots = (participants, viewerId) => {
    if (!Array.isArray(participants)) {
        return participants;
    }

    participants.forEach((participant) =>
        applyBlockSnapshot(participant, viewerId)
    );

    return participants;
};

// Fields to add to a participants `select` so the snapshot can be applied
// (and then stripped) before the payload leaves the server.
// -> "blockedUsers blockedSnapshots"

module.exports = {
    applyBlockSnapshot,
    applyBlockSnapshots
};
