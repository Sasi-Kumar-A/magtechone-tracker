# Build and run the API without Maven: plain JDK, no dependencies.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY src ./src
RUN javac -d out $(find src -name "*.java") \
 && jar --create --file tracker.jar --main-class com.magtech.tracker.Main -C out .

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/tracker.jar .
ENV PORT=8080
EXPOSE 8080
CMD ["java", "-jar", "tracker.jar"]
