const fs = require("fs").promises;

async function loadFiles() {
  const groups = JSON.parse(await fs.readFile("./assets/groups.json"));
  const exibitions = JSON.parse(await fs.readFile("./assets/exibitions.json"));
  return { groups, exibitions };
}

function playMatch(team1, team2) {
  const rankDiff = (team2.fibaRank - team1.fibaRank) / 100;
  const formFactorDiff = team1.formFactor - team2.formFactor;
  const randomFactor = Math.random() - 0.5;

  const team1WinChance =
    0.5 + rankDiff * 0.3 + formFactorDiff * 0.4 + randomFactor;

  const team1Score = Math.floor(Math.random() * (100 - 60) + 55);
  const team2Score = Math.floor(Math.random() * (100 - 60) + 55);

  if (team1WinChance < 0.01 || team1WinChance > 0.99) {
    // dodatni random faktor za odustajanje, kako bi bila sto manja verovatnoca za predaju
    // 0.02 -> 2% sanse za predaju
    const resignedProbability = Math.random();
    if (resignedProbability < 0.02) {
      const resignedTeam = team1WinChance < 0.01 ? team1 : team2;

      return {
        team1,
        team2,
        team1Score: resignedTeam === team1 ? 0 : team1Score + 10,
        team2Score: resignedTeam === team2 ? 0 : team2Score + 10,
        result: "resigned",
        resignedTeam: resignedTeam.name,
      };
    }
  }

  if (team1WinChance > 0.5) {
    const scoreDiff = team1Score - team2Score;
    team1.updateFormFactor(team2.fibaRank, scoreDiff);
    team2.updateFormFactor(team1.fibaRank, -scoreDiff);

    return {
      team1,
      team2,
      team1Score: team1Score + 10,
      team2Score,
    };
  } else {
    const scoreDiff = team2Score - team1Score;
    team1.updateFormFactor(team2.fibaRank, -scoreDiff);
    team2.updateFormFactor(team1.fibaRank, scoreDiff);

    return {
      team1,
      team2,
      team1Score,
      team2Score: team2Score + 10,
    };
  }
}

function playMatchAsync(team1, team2) {
  return new Promise((resolve) => {
    const result = playMatch(team1, team2);
    resolve(result);
  });
}

class Team {
  constructor(name, isoCode, fibaRank, exibitions) {
    this.name = name;
    this.isoCode = isoCode;
    this.fibaRank = fibaRank;
    this.points = 0;
    this.scoredPoints = 0;
    this.concededPoints = 0;
    this.wins = 0;
    this.losses = 0;
    this.exibitions = exibitions;
    this.formFactor = this.calcFormFactor();
  }

  calcFormFactor() {
    const matches = this.exibitions[this.isoCode];
    if (!matches) return 0;

    let totalDiff = 0;
    for (const match of matches) {
      const [teamScore, opponentScore] = match.Result.split("-").map(Number);
      totalDiff += teamScore - opponentScore;
    }
    return totalDiff / matches.length;
  }

  getScorePointDiff() {
    return this.scoredPoints - this.concededPoints;
  }

  updateFormFactor(opponentRank, scoreDiff) {
    const opponentStrength = 100 / opponentRank;
    this.formFactor = (this.formFactor + scoreDiff * opponentStrength) / 2;
  }
}

class Group {
  constructor(name, teams, exibitions) {
    this.name = name;
    this.teams = teams.map(
      (team) => new Team(team.Team, team.ISOCode, team.FIBARanking, exibitions),
    );
    this.matches = [];
  }

  async playGroupPhase() {
    const groupRounds = [];

    const numTeams = this.teams.length;
    const isOdd = numTeams % 2 !== 0;
    const numRounds = isOdd ? numTeams : numTeams - 1; // broj kola je broj timova ako je neparan, ili broj timova minus 1 ako je paran
    const halfSize = Math.floor(numTeams / 2);

    let teams = this.teams.slice();

    // dodajemo null mesto ako je broj timova neparan
    if (isOdd) {
      teams.push(null);
    }

    for (let round = 0; round < numRounds; round++) {
      const roundMatches = [];
      const matchPromises = [];

      for (let i = 0; i < halfSize; i++) {
        const home = teams[i];
        const away = teams[teams.length - 1 - i];

        if (home && away) {
          matchPromises.push(
            playMatchAsync(home, away).then((match) => {
              this.matches.push(match);
              this.updateTeamStats(match);
              roundMatches.push(match);
            }),
          );
        }
      }

      await Promise.all(matchPromises);

      // rotacija timova
      const newTeams = [teams[0], ...teams.slice(-1), ...teams.slice(1, -1)];
      teams = newTeams; // excluded splice -> replaced with index manipulation

      groupRounds.push(roundMatches);
    }

    return groupRounds;
  }

  updateTeamStats(match) {
    const { team1, team2, team1Score, team2Score, result, resignedTeam } =
      match;

    if (result === "resigned") {
      // predaja
      if (resignedTeam === team1.name) {
        team2.wins++;
        team2.points += 2; // team 2 dobija 2 boda zbog predaje team 1
        team1.losses++;
        team1.points += 0; // team 1 gubi predajom i dobija 0 bodova
      } else {
        team1.wins++;
        team1.points += 2; // team 1 dobija 2 boda zbog predaje team 2
        team2.losses++;
        team2.points += 0; // team 2 gubi predajom i dobija 0 bodova
      }
    } else {
      // regularno
      team1.scoredPoints += team1Score;
      team1.concededPoints += team2Score;
      team2.scoredPoints += team2Score;
      team2.concededPoints += team1Score;

      if (team1Score > team2Score) {
        team1.wins++;
        team1.points += 2; // regularna pobeda - 2 boda za pobedu
        team2.losses++;
        team2.points += 1; // regularan poraz - 1 bod za poraz
      } else {
        team2.wins++;
        team2.points += 2; // regularna pobeda - 2 boda za pobedu
        team1.losses++;
        team1.points += 1; // regularan poraz - 1 bod za poraz
      }
    }
  }

  rankTeams() {
    return this.teams.sort((a, b) => {
      // prvo rangiramo timove po bodovima
      if (b.points !== a.points) return b.points - a.points;

      // nalazimo timove sa istim brojem bodova
      const tiedTeams = this.teams.filter((team) => team.points === a.points);

      // ako postoje dva tima sa istim bodovima, koristimo rezultat medjusobnog susreta
      if (tiedTeams.length === 2) {
        const matchBetween = this.matches.find(
          (match) =>
            (match.team1 === a && match.team2 === b) ||
            (match.team1 === b && match.team2 === a),
        );

        if (matchBetween) {
          if (
            matchBetween.team1 === a &&
            matchBetween.team1Score > matchBetween.team2Score
          )
            return -1; // a team je pobedio b team, a ide iznad

          if (
            matchBetween.team1 === b &&
            matchBetween.team2Score > matchBetween.team1Score
          )
            return 1; // b team je pobedio a team, b ide iznad
        }
      }

      // ako ima vise od dva tima sa istim brojem bodova, koristimo razliku u poenima iz medjusobnih utakmica
      if (tiedTeams.length > 2) {
        const scoreDiffA = this.calcScoreDiffInMatches(a, tiedTeams);
        const scoreDiffB = this.calcScoreDiffInMatches(b, tiedTeams);

        if (scoreDiffA !== scoreDiffB) return scoreDiffB - scoreDiffA;
      }

      // ako je i dalje neresno, upoređujemo ukupnu razliku u poenima (postignuti minus primljeni poeni)
      if (b.getScorePointDiff() !== a.getScorePointDiff()) {
        return b.getScorePointDiff() - a.getScorePointDiff();
      }

      // ako je i dalje nereseno, upoređujemo broj postignutih poena
      return b.scoredPoints - a.scoredPoints;
    });
  }

  calcScoreDiffInMatches(team, tiedTeams) {
    let totalDiff = 0;

    this.matches.forEach((match) => {
      // pronalazimo timove u matchevima
      // i racunamo diff vrednosti
      if (
        tiedTeams.includes(match.team1) &&
        tiedTeams.includes(match.team2) &&
        (match.team1 === team || match.team2 === team)
      ) {
        if (match.team1 === team) {
          totalDiff += match.team1Score - match.team2Score;
        } else {
          totalDiff += match.team2Score - match.team1Score;
        }
      }
    });

    // ukupna razlika u poenima za trenutni team u matchevima protiv timova iz tiedTeams
    return totalDiff;
  }
}

class Olimpijada {
  constructor(groupsData, exibitions) {
    this.groups = Object.entries(groupsData).map(
      ([groupName, teams]) => new Group(groupName, teams, exibitions),
    );
  }

  async startGroupStage() {
    const rounds = {};

    // group phase concurrent
    await Promise.all(
      this.groups.map(async (group) => {
        const groupRounds = await group.playGroupPhase();
        groupRounds.forEach((matches, roundIndex) => {
          const roundKey = `Kolo ${roundIndex + 1}`;
          if (!rounds[roundKey]) {
            rounds[roundKey] = [];
          }
          rounds[roundKey].push({
            groupName: group.name,
            matches,
          });
        });
      }),
    );

    this.printRounds(rounds);
  }

  printRounds(rounds) {
    Object.keys(rounds).forEach((round) => {
      console.log(`\nGrupna faza - ${round}:`);
      rounds[round].forEach(({ groupName, matches }) => {
        console.log(`    Grupa ${groupName}:`);
        matches.forEach((match) => {
          if (match.result === "resigned") {
            console.log(
              `        ${match.team1.name} - ${match.team2.name} (${match.team1Score}:${match.team2Score}) - (Predaja: ${match.resignedTeam}).`,
            );
          } else {
            console.log(
              `        ${match.team1.name} - ${match.team2.name} (${match.team1Score}:${match.team2Score})`,
            );
          }
        });
      });
    });
  }

  showGroupResults() {
    this.groups.forEach((group) => {
      console.log(`\nKonacan rezultat za grupu: ${group.name}:`);
      group.rankTeams().forEach((team, index) => {
        console.log(
          `${index + 1}. ${team.name} - Pobede: ${team.wins}, Porazi: ${team.losses}, Postignuti poeni: ${team.points}, Postignuti koševi: ${team.scoredPoints}, Primljeni koševi: ${team.concededPoints}, koševi razlike: ${team.getScorePointDiff()}`,
        );
      });
    });
  }

  sortStandings() {
    const firstPlacedTeams = [];
    const secondPlacedTeams = [];
    const thirdPlacedTeams = [];

    // rasporedjujemo timove po plasmanima
    this.groups.forEach((group) => {
      const rankedTeams = group.rankTeams();
      firstPlacedTeams.push(rankedTeams[0]);
      secondPlacedTeams.push(rankedTeams[1]);
      thirdPlacedTeams.push(rankedTeams[2]);
    });

    // sortiramo timove u plasmanima
    const sortedFirstPlaced = this.sortTeams(firstPlacedTeams);
    const sortedSecondPlaced = this.sortTeams(secondPlacedTeams);
    const sortedThirdPlaced = this.sortTeams(thirdPlacedTeams);

    // vracamo rangirane sortirane timove po plasmanima
    return [...sortedFirstPlaced, ...sortedSecondPlaced, ...sortedThirdPlaced];
  }

  sortTeams(teams) {
    return teams.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.getScorePointDiff() !== a.getScorePointDiff())
        return b.getScorePointDiff() - a.getScorePointDiff();
      return b.scoredPoints - a.scoredPoints;
    });
  }

  async runTournament() {
    const finalStandings = this.sortStandings();

    // slice => [0, 1) - 0 included, 1 excluded
    const potD = finalStandings.slice(0, 2); // 1 i 2
    const potE = finalStandings.slice(2, 4); // 3 i 4
    const potF = finalStandings.slice(4, 6); // 5 i 6
    const potG = finalStandings.slice(6, 8); // 7 i 8

    console.log("\nŠeširi:");
    console.log("    Šešir D");
    potD.forEach((team) => console.log(`        ${team.name}`));
    console.log("    Šešir E");
    potE.forEach((team) => console.log(`        ${team.name}`));
    console.log("    Šešir F");
    potF.forEach((team) => console.log(`        ${team.name}`));
    console.log("    Šešir G");
    potG.forEach((team) => console.log(`        ${team.name}`));

    this.quarterfinals = this.createQuarterfinals(potD, potE, potF, potG);

    console.log("\nEliminaciona faza:");
    this.quarterfinals.forEach((pair) => {
      console.log(`    ${pair.team1.name} - ${pair.team2.name}`);
    });

    // async
    this.semifinals = await this.playQuarterfinals();

    // async
    const { finalists, bronzeMatch } = await this.playSemifinals();

    // async
    const bronzeMatchResult = await playMatchAsync(
      bronzeMatch[0],
      bronzeMatch[1],
    );

    let bronzeWinner;
    if (bronzeMatchResult.result === "resigned") {
      bronzeWinner =
        bronzeMatchResult.resignedTeam === bronzeMatch[0].name
          ? bronzeMatch[1]
          : bronzeMatch[0];

      console.log("\nUtakmica za treće mesto:");
      console.log(
        `    ${bronzeMatch[0].name} - ${bronzeMatch[1].name} (Predaja: ${bronzeMatchResult.resignedTeam})`,
      );
    } else {
      bronzeWinner =
        bronzeMatchResult.team1Score > bronzeMatchResult.team2Score
          ? bronzeMatch[0]
          : bronzeMatch[1];

      console.log("\nUtakmica za treće mesto:");
      console.log(
        `    ${bronzeMatch[0].name} - ${bronzeMatch[1].name} (${bronzeMatchResult.team1Score}: ${bronzeMatchResult.team2Score})`,
      );
    }

    // async
    const { gold, silver } = await this.playFinals(finalists);

    console.log("\nMedalje:");
    console.log(`    1. ${gold.name} -> Zlato`);
    console.log(`    2. ${silver.name} -> Srebro`);
    console.log(`    3. ${bronzeWinner.name} -> Bronza`);
  }

  createQuarterfinals(potD, potE, potF, potG) {
    const potentialMatches = [];

    const formedMatches = new Set();

    // D vs G
    while (potD.length > 0 && potG.length > 0) {
      const teamD = potD.pop();
      const teamG = this.getValidOpponent(potG, formedMatches, teamD);
      if (teamG) {
        formedMatches.add(`${teamD.name}-${teamG.name}`);
        potentialMatches.push({
          team1: teamD,
          team2: teamG,
          origin: "DvsG",
        });
        potG = potG.filter((team) => team !== teamG);
      }
    }

    // E vs F
    while (potE.length > 0 && potF.length > 0) {
      const teamE = potE.pop();
      const teamF = this.getValidOpponent(potF, formedMatches, teamE);
      if (teamF) {
        formedMatches.add(`${teamE.name}-${teamF.name}`);
        potentialMatches.push({
          team1: teamE,
          team2: teamF,
          origin: "EvsF",
        });
        potF = potF.filter((team) => team !== teamF);
      }
    }

    return potentialMatches;
  }

  getValidOpponent(pot, formedMatches, currentTeam) {
    if (!currentTeam || !Array.isArray(pot) || pot.length === 0) {
      return null;
    }

    for (let i = 0; i < pot.length; i++) {
      const opponent = pot[i];
      if (opponent && currentTeam) {
        if (
          !formedMatches.has(`${currentTeam.name}-${opponent.name}`) &&
          !this.teamsPlayedAlready(currentTeam, opponent)
        ) {
          return opponent;
        }
      }
    }

    // ako nije pronadjen validan protivnik, vrati prvog
    return pot[0];
  }

  teamsPlayedAlready(team1, team2) {
    return this.groups.some((group) =>
      group.matches.some(
        (match) =>
          (match.team1 === team1 && match.team2 === team2) ||
          (match.team1 === team2 && match.team2 === team1),
      ),
    );
  }

  async playQuarterfinals() {
    const results = {
      DvsG: [],
      EvsF: [],
    };

    console.log("\nČetvrtfinale:");
    await Promise.all(
      this.quarterfinals.map(async (match) => {
        const matchResult = await playMatchAsync(match.team1, match.team2);

        if (matchResult.result === "resigned") {
          const winner =
            matchResult.resignedTeam === match.team1.name
              ? match.team2
              : match.team1;

          console.log(
            `    ${match.team1.name} - ${match.team2.name} (Predaja: ${matchResult.resignedTeam})`,
          );

          results[match.origin].push(winner);
        } else {
          console.log(
            `    ${match.team1.name} - ${match.team2.name} (${matchResult.team1Score}: ${matchResult.team2Score})`,
          );

          const winner =
            matchResult.team1Score > matchResult.team2Score
              ? match.team1
              : match.team2;

          results[match.origin].push(winner);
        }
      }),
    );

    return this.createSemifinals(results.DvsG, results.EvsF);
  }

  createSemifinals(DvsGWinners, EvsFWinners) {
    const shuffledDvsG = DvsGWinners.sort(() => Math.random() - 0.5);
    const shuffledEvsF = EvsFWinners.sort(() => Math.random() - 0.5);

    const semifinals = [];

    while (shuffledDvsG.length > 0 && shuffledEvsF.length > 0) {
      const teamFromDvsG = shuffledDvsG.pop();
      const teamFromEvsF = shuffledEvsF.pop();

      semifinals.push({
        team1: teamFromDvsG,
        team2: teamFromEvsF,
      });
    }

    return semifinals;
  }

  async playSemifinals() {
    const finalists = [];
    const bronzeMatch = [];

    console.log("\nPolufinale:");
    await Promise.all(
      this.semifinals.map(async (match) => {
        const matchResult = await playMatchAsync(match.team1, match.team2);

        if (matchResult.result === "resigned") {
          const winner =
            matchResult.resignedTeam === match.team1.name
              ? match.team2
              : match.team1;
          const loser =
            matchResult.resignedTeam === match.team1.name
              ? match.team1
              : match.team2;

          console.log(
            `    ${match.team1.name} - ${match.team2.name} (Predaja: ${matchResult.resignedTeam})`,
          );

          finalists.push(winner);
          bronzeMatch.push(loser);
        } else {
          console.log(
            `    ${match.team1.name} - ${match.team2.name} (${matchResult.team1Score}: ${matchResult.team2Score})`,
          );

          const winner =
            matchResult.team1Score > matchResult.team2Score
              ? match.team1
              : match.team2;
          const loser =
            matchResult.team1Score > matchResult.team2Score
              ? match.team2
              : match.team1;

          finalists.push(winner);
          bronzeMatch.push(loser);
        }
      }),
    );

    return { finalists, bronzeMatch };
  }

  async playFinals(finalists) {
    const finalMatch = await playMatchAsync(finalists[0], finalists[1]);

    if (finalMatch.result === "resigned") {
      const gold =
        finalMatch.resignedTeam === finalists[0].name
          ? finalists[1]
          : finalists[0];
      const silver =
        finalMatch.resignedTeam === finalists[0].name
          ? finalists[0]
          : finalists[1];

      console.log(
        `    ${finalists[0].name} - ${finalists[1].name} (Predaja: ${finalMatch.resignedTeam})`,
      );

      return { gold, silver };
    } else {
      const gold =
        finalMatch.team1Score > finalMatch.team2Score
          ? finalists[0]
          : finalists[1];
      const silver =
        finalMatch.team1Score > finalMatch.team2Score
          ? finalists[1]
          : finalists[0];

      console.log("\nFinale:");
      console.log(
        `    ${finalists[0].name} - ${finalists[1].name} (${finalMatch.team1Score}: ${finalMatch.team2Score})`,
      );

      return { gold, silver };
    }
  }
}

const main = async () => {
  const { groups, exibitions } = await loadFiles();

  const olimpijada = new Olimpijada(groups, exibitions);
  // grupna faza
  await olimpijada.startGroupStage();
  // rezultat grupne faze
  olimpijada.showGroupResults();
  // finalna faza
  await olimpijada.runTournament();
};

main();
