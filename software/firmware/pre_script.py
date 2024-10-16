Import("env")

castxml_env = env.Clone()

# castxml_env.Replace(CC="castxml", CXX="castxml")

print(castxml_env.subst("$CXXFLAGS"))
print(castxml_env.subst("$CXXCOM"))

# print("DSAB FGIKVHSDBGUHIJKSB")
# castxml_env.BuildProgram()
# print("DSJHBUIDBDBBNBD")