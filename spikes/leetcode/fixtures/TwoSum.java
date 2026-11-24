// DuoLeetCode integration probe: an O(n) synthetic fixture, not an assessed attempt.
class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer previous = seen.get(target - nums[i]);
            if (previous != null) return new int[] {previous, i};
            seen.put(nums[i], i);
        }
        throw new IllegalArgumentException("No solution");
    }
}
