## Inspiration
Urban mobility is one of the biggest challenges of our time. Cities like New York, Los Angeles, and Chicago lose billions of dollars annually due to traffic congestion. According to the INRIX Global Traffic Scorecard, drivers in New York City lose on average **117 hours per year** stuck in traffic, costing more than **$1,700 per driver annually** in lost productivity. UAVs (unmanned aerial vehicles) can unlock the airspace above cities and create entirely new pathways for efficient, safe, and time-saving transportation and delivery. The UAV Path Optimizer is built to solve this exact problem, turning gridlocked hours into minutes by enabling smarter navigation through complex urban landscapes.

## Intuition
This algorithm builds directly on the classical A* pathfinding algorithm. A* relies on a single heuristic to guide the search, but for UAVs flying in dense cities a single heuristic is not enough. UAVs must balance multiple objectives such as keeping a safe distance from buildings, aligning with the overall goal direction, and navigating efficiently across large-scale maps. To address this, the algorithm runs **multiple heuristics in parallel**: one for distance, one for clearance from obstacles, one for global progress using landmarks, and one for bearing alignment.  

Simply running multiple heuristics is not sufficient. Different heuristics are useful in different regions of the city, so we introduce a **scheduling algorithm based on multi-armed bandits**. This scheduler learns in real time which heuristic is performing best for the current environment and chooses accordingly. The result is a planner that adapts its decision-making to the unique challenges of each area while still maintaining the safety guarantees of A*.

## Explanation
We implemented **Bandit Multi-Heuristic A*** (BMHA*), an algorithm that leverages multiple search heuristics simultaneously:
- **Anchor Queue (Admissible):** Ensures safety and guarantees optimal or near-optimal solutions.
- **Clearance-Aware Queue:** Prefers paths with greater distance from obstacles for smoother and safer flights.
- **Landmark Queue:** Uses pre-computed distances to corner landmarks to estimate progress efficiently.
- **Bearing-Biased Queue:** Prefers directions aligned with the goal to reduce zig-zagging.

A **contextual bandit algorithm (UCB1)** decides which queue to expand at every step, learning which heuristic performs best in the current environment. This balances exploration and exploitation in real time.

The grid precomputation phase creates a **clearance map** from obstacles, allowing UAVs to dynamically adjust speed based on local clearance. Closer to buildings → fly slower; in open air → accelerate.


## Complexity Analysis
Like standard A*, BMHA* has complexity tied to the size of the search grid. If the grid is **W × H** with branching factor **b** and path length **d**, the worst-case runtime of A* is **O(b^d)** but in practice is closer to **O(N log N)** where **N = W × H** due to the use of priority queues.  

BMHA* introduces multiple open lists (four queues in our case). Each insertion and extraction from a queue is **O(log N)**, and with k queues this scales to **O(k log N)** per expansion. Since k is constant and small, the asymptotic complexity remains **O(N log N)**. The overhead of computing multiple heuristics is linear in k per node but still bounded.  

The **bandit scheduling** adds minimal overhead since UCB1 selection requires only constant-time arithmetic over the k heuristics.  

**Space complexity** is also **O(N)** for storing g-costs, clearance values, and parent links. The clearance precomputation step runs in **O(N)** time with two sweeps over the grid.  

In practice, BMHA* is slightly slower than vanilla A* on open maps but performs significantly better in dense urban maps because it avoids exploring misleading regions by leveraging the most effective heuristic dynamically.

## Simulation Engine
The simulation engine provides a **real-time 3D visualization** of the UAV path planning process, enabling users to observe and validate the algorithm's performance in realistic urban environments.

### Core Components
- **World Representation:** The simulation uses OpenStreetMap (OSM) data to create accurate 3D city models with buildings, roads, and terrain features. This provides a realistic environment for testing UAV navigation algorithms.(Real city simulation is slower than synthetic city simulation)

### Interactive Features
- **Multiple Algorithm Comparison:** The simulation supports switching between different pathfinding algorithms (BMHA*, straight-line) for side-by-side performance comparison.
- **3D Camera Controls:** Users can navigate the 3D environment, zoom into specific areas, and follow the UAV along its planned path for detailed analysis.

### Performance Monitoring
- **Visual Debugging:** Color-coded visualization shows different heuristic queues, explored vs. unexplored areas, and clearance levels, making it easier to debug and optimize the algorithm.

The simulation engine serves as both a **validation tool** for algorithm correctness and a **research platform** for developing new UAV navigation strategies in complex urban environments.

## Challenges we ran into
- **Scalability:** Running full grid-based clearance computations on large cities (>300k cells) caused performance bottlenecks. We had to introduce coarse grid fallbacks.
- **Integration with simulation:** Getting the planner to smoothly integrate with the simulation backend required debugging.

## Accomplishments that I'm proud of
- Implemented a **working BMHA* planner** that dynamically chooses heuristics using bandit learning.
- Achieved **collision-free flight paths** in dense urban maps with thousands of obstacles.
- Designed an adaptive speed model where UAVs naturally **slow near buildings and accelerate in open areas**.
- Demonstrated scalability with fallback methods for extremely large maps.

## What we learned
- Classical AI planning methods like A* can be significantly enhanced with **modern learning-based decision strategies** (bandits).
- Clearance-aware navigation is **just as important as shortest path** since safety and smoothness matter in UAV flight.
- Integrating multiple heuristics requires not only careful weighting but also a mechanism to learn their utility in context.
- The trade-off between **optimality and runtime performance** is key for real-time applications.

## What's next for UAV Path Optimizer
- **Dynamic Obstacles:** Extend the planner to handle moving obstacles such as other UAVs, helicopters, or dynamic no-fly zones.
- **Energy-Aware Planning:** Incorporate UAV battery models so that paths are optimized for **both time and energy efficiency**.
- **3D Urban Airspace:** Extend the grid to true 3D navigation, accounting for altitude layers, wind patterns, and regulations.

## References
[Multi-Heuristic A*](https://www.cs.cmu.edu/~maxim/files/mha_ijrr15.pdf)

[UCB1](https://homes.di.unimi.it/~cesabian/Pubblicazioni/ml-02.pdf)